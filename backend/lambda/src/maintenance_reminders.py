"""ClueNest AI - Daily maintenance reminder check and e-mail delivery, started by an Amazon EventBridge schedule.
It is NOT an API function: nobody can call it through API Gateway, and it has no user.
Once a day it finds the pending maintenance reminders (the items maintenance.py writes:
PK = USER#<sub>, SK = MAINTENANCE#<id>, status "pending", dueDate "YYYY-MM-DD") that are due today
or overdue, and logs ONE line with counts.
E-mail delivery (reminder_delivery.py) happens only when TOPIC_ARN_PREFIX is set, and only for users who
opted in AND confirmed their e-mail address in Amazon SNS. Each user has their own SNS topic, so a reminder
can only reach that user. Without TOPIC_ARN_PREFIX this function only counts, as before.
It never changes, completes or deletes a reminder, and the reminder logic of maintenance.py is unchanged.
The only things it writes are its own notification-ledger items (SK = NOTIFY#...). Only Scan is permitted to its role, because the table
has no index by due date. Scan reads the whole table once a day, which is fine for a small table. For a
large one, add an index on the due date instead (see backend/README.md).
Privacy: only counts are logged. When delivery is off, DynamoDB is asked for just the user ID and due date.
When it is on, the reminder id, task name and appliance name are also read (to write the user's own e-mail).
Nothing personal is ever logged.
Due dates are calendar dates without a time zone, so "today" is the UTC date. The schedule runs at
12:00 UTC (7 or 8 a.m. in Toronto), so the UTC date equals the date in North America.
"""
import logging
import reminder_delivery
from cluenest_common import table, today_utc

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)
SCAN_PAGE_LIMIT = 500            # items evaluated per Scan call
MAX_PAGES = 2000                 # safety stop (about 1,000,000 items evaluated)
MIN_REMAINING_MS = 8000          # stop early, and say so, when the function is close to its timeout


def is_schedule_event(event):
    """True only for the event EventBridge sends for a scheduled rule."""
    return (isinstance(event, dict) and event.get("source") == "aws.events"
            and event.get("detail-type") == "Scheduled Event")


def find_due(today, context=None, collect=None):
    """Counts of pending reminders that are due today or overdue. Read-only.
    When collect is a dict, the due reminders are also grouped into it by user ID (for delivery)."""
    iso = today.isoformat()
    scanned = pending = due_today = overdue = 0
    users = set()
    complete = True
    kwargs = {
        "FilterExpression": "entityType = :t AND #s = :p AND dueDate <= :today",
        "ProjectionExpression": "userId, dueDate" if collect is None else "userId, dueDate, #i, taskName, applianceName",
        "ExpressionAttributeNames": {"#s": "status"} if collect is None else {"#s": "status", "#i": "id"},
        "ExpressionAttributeValues": {":t": "MAINTENANCE", ":p": "pending", ":today": iso},
        "Limit": SCAN_PAGE_LIMIT,
        "ConsistentRead": False,
    }
    for _ in range(MAX_PAGES):
        page = table().scan(**kwargs)
        scanned += page.get("ScannedCount", 0)
        for item in page.get("Items", []):
            pending += 1
            if item.get("dueDate") == iso:
                due_today += 1
            else:
                overdue += 1
            if isinstance(item.get("userId"), str):
                users.add(item["userId"])
                if collect is not None and isinstance(item.get("id"), str) and isinstance(item.get("dueDate"), str):
                    collect.setdefault(item["userId"], []).append(item)
        start = page.get("LastEvaluatedKey")
        if not start:
            break
        if context is not None and context.get_remaining_time_in_millis() < MIN_REMAINING_MS:
            complete = False
            break
        kwargs["ExclusiveStartKey"] = start
    else:
        complete = False
    return {"date": iso, "itemsScanned": scanned, "dueOrOverdue": pending, "dueToday": due_today,
            "overdue": overdue, "usersWithDueReminders": len(users), "complete": complete}


def deliver_all(by_user, context=None):
    """Sends each opted-in, confirmed user their own e-mail. Returns counts only."""
    counts = {"notOptedIn": 0, "noConfirmedSubscription": 0, "nothingNew": 0, "sent": 0, "failed": 0, "errors": 0, "complete": True}
    names = {"not_opted_in": "notOptedIn", "no_subscription": "noConfirmedSubscription", "nothing_new": "nothingNew",
             "sent": "sent", "failed": "failed"}
    for sub in sorted(by_user):
        if context is not None and context.get_remaining_time_in_millis() < MIN_REMAINING_MS:
            counts["complete"] = False
            break
        try:
            counts[names[reminder_delivery.deliver_user(sub, by_user[sub])]] += 1
        except Exception as error:                                # one user's problem must not stop the others
            LOG.warning("Delivery error: %s", type(error).__name__)
            counts["errors"] += 1
    return counts


def handler(event, context):
    if not is_schedule_event(event):
        LOG.warning("Ignored an event that is not an EventBridge schedule")
        return {"ok": False, "reason": "not a scheduled event"}
    by_user = {} if reminder_delivery.configured() else None
    result = find_due(today_utc(), context, collect=by_user)
    LOG.info("Maintenance reminder check: date=%s scanned=%d due_or_overdue=%d due_today=%d overdue=%d users=%d complete=%s",
             result["date"], result["itemsScanned"], result["dueOrOverdue"], result["dueToday"],
             result["overdue"], result["usersWithDueReminders"], result["complete"])
    if not result["complete"]:
        LOG.warning("The check stopped before the whole table was read")
    if by_user is not None:
        result["delivery"] = deliver_all(by_user, context)
        d = result["delivery"]
        LOG.info("Reminder delivery: sent=%d failed=%d not_opted_in=%d no_confirmed_subscription=%d nothing_new=%d errors=%d complete=%s",
                 d["sent"], d["failed"], d["notOptedIn"], d["noConfirmedSubscription"], d["nothingNew"], d["errors"], d["complete"])
    return {"ok": True, **result}
