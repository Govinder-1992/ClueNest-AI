"""ClueNest AI - Maintenance reminders function.

Operations (the route names are chosen in the API Gateway step):
    GET    /maintenance                list reminders (every status), earliest due date first
    POST   /maintenance                create a reminder
    GET    /maintenance/{id}           read one reminder
    PUT    /maintenance/{id}           edit a reminder (only while it is pending)
    DELETE /maintenance/{id}           delete a reminder (only while it is pending)
    POST   /maintenance/{id}/complete  mark complete; a repeating reminder gets its next occurrence

DynamoDB: PK = USER#<sub>, SK = MAINTENANCE#<id>. Only GetItem, PutItem, DeleteItem and Query are used.
(TransactWriteItems made only of Put operations needs just the dynamodb:PutItem permission.)

Completing a reminder keeps it as history and creates the next occurrence as a NEW item.
Both writes happen in one transaction. The next occurrence's id is derived from the series and
its due date, so replaying a request can never create a duplicate.

Upcoming, Overdue and Completed are NOT calculated here. The list returns the dates and the
status ("pending" or "completed"), and the app compares the due date with the user's local date.
"""

import uuid

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

from cluenest_common import (
    ApiError, Validator, add_months, appliance_snapshot, delete_item, get_item, get_method, get_path,
    get_path_id, is_conditional_failure, load_appliance, new_id, not_found, now_iso, parse_body,
    parse_date, pick, pk_for, put_item, put_op, query_prefix, run, today_utc, transact,
)

REPEAT_MONTHS = {"once": 0, "monthly": 1, "quarterly": 3, "semiannual": 6, "yearly": 12}
PUBLIC_KEYS = ["applianceId", "applianceName", "applianceBrand", "applianceModel", "applianceType",
               "taskName", "description", "notes", "dueDate", "repeat", "status", "completedDate",
               "seriesId", "createdAt", "updatedAt"]
# Fixed namespace: the next occurrence of a series gets the same id every time it is calculated.
NEXT_OCCURRENCE_NAMESPACE = uuid.UUID("6f1d2c8e-5b7a-4c3d-9e21-0a4b7c9d8e11")


def handler(event, context):
    return run(event, route)


def route(event, sub):
    method = get_method(event)
    reminder_id = get_path_id(event)
    if reminder_id is None:
        if method == "GET":
            return list_reminders(sub)
        if method == "POST":
            return create_reminder(sub, parse_body(event))
    else:
        if method == "POST" and get_path(event).rstrip("/").endswith("/complete"):
            return complete_reminder(sub, reminder_id, parse_body(event, required=False))
        if method == "GET":
            return get_reminder(sub, reminder_id)
        if method == "PUT":
            return update_reminder(sub, reminder_id, parse_body(event))
        if method == "DELETE":
            return delete_reminder(sub, reminder_id)
    raise ApiError(405, "METHOD_NOT_ALLOWED", "This operation is not supported.")


# ---------------------------------------------------------------- recurrence

def next_due_date(due, repeat, anchor_day, completed):
    """Next due date for a repeating reminder, or None for a one-time reminder.

    It follows the original schedule and skips every date that is on or before the completion
    date. anchor_day stops a 31st-of-the-month schedule from drifting after a short month.
    """
    months = REPEAT_MONTHS.get(repeat, 0)
    if not months:
        return None
    for step in range(1, 2001):
        candidate = add_months(due, step * months, anchor_day)
        if candidate > completed:
            return candidate
    return None


# ---------------------------------------------------------------- validation and shape

def validate_reminder(sub, body):
    today = today_utc()
    v = Validator(body)
    v.text("applianceId", 64, required=True)
    v.text("taskName", 100, required=True)
    v.text("description", 500, multiline=True)
    v.date("dueDate", required=True, min_date=add_months(today, -120), max_date=add_months(today, 360),
           min_message="The due date is too far in the past (more than 10 years).",
           max_message="The due date is too far ahead (more than 30 years).")
    v.choice("repeat", list(REPEAT_MONTHS), required=False)
    v.text("notes", 1000, multiline=True)
    v.check()
    values = dict(v.values)
    values.setdefault("repeat", "once")
    appliance = load_appliance(sub, values["applianceId"])
    if appliance is None:
        raise ApiError(400, "APPLIANCE_NOT_FOUND", "The selected appliance was not found.",
                       fields={"applianceId": "Select one of your appliances."})
    return values, appliance


def build_reminder(sub, values, appliance, existing=None):
    now = now_iso()
    reminder_id = existing["id"] if existing else new_id()
    item = {"PK": pk_for(sub), "SK": "MAINTENANCE#" + reminder_id, "entityType": "MAINTENANCE",
            "userId": sub, "id": reminder_id,
            "seriesId": existing["seriesId"] if existing else reminder_id}
    item.update(appliance_snapshot(appliance))
    for key in ("taskName", "description", "notes", "dueDate", "repeat"):
        if key in values:
            item[key] = values[key]
    item["anchorDay"] = parse_date(values["dueDate"]).day
    item["status"] = "pending"
    item["createdAt"] = existing["createdAt"] if existing else now
    item["updatedAt"] = now
    return item


def to_public(item):
    out = {"id": item["id"]}
    out.update(pick(item, PUBLIC_KEYS))
    return out


# ---------------------------------------------------------------- operations

def list_reminders(sub):
    items, truncated = query_prefix(sub, "MAINTENANCE#")
    items.sort(key=lambda i: (i.get("dueDate", ""), i.get("taskName", "")))
    return 200, {"reminders": [to_public(i) for i in items], "count": len(items), "truncated": truncated}


def create_reminder(sub, body):
    values, appliance = validate_reminder(sub, body)
    item = build_reminder(sub, values, appliance)
    put_item(item, condition=Attr("PK").not_exists())
    return 201, {"reminder": to_public(item)}


def get_reminder(sub, reminder_id):
    item = get_item(sub, "MAINTENANCE#" + reminder_id)
    if not item:
        raise not_found("The reminder")
    return 200, {"reminder": to_public(item)}


def _existing_pending(sub, reminder_id, action):
    item = get_item(sub, "MAINTENANCE#" + reminder_id)
    if not item:
        raise not_found("The reminder")
    if item.get("status") != "pending":
        raise ApiError(409, "ALREADY_COMPLETED",
                       "Completed reminders are kept as maintenance history and can't be %s." % action)
    return item


def update_reminder(sub, reminder_id, body):
    values, appliance = validate_reminder(sub, body)
    existing = _existing_pending(sub, reminder_id, "edited")
    item = build_reminder(sub, values, appliance, existing)
    try:
        put_item(item, condition=Attr("PK").exists() & Attr("status").eq("pending"))
    except ClientError as error:
        if is_conditional_failure(error):
            raise ApiError(409, "CONFLICT", "This reminder was changed by another request. Refresh and try again.")
        raise
    return 200, {"reminder": to_public(item)}


def delete_reminder(sub, reminder_id):
    _existing_pending(sub, reminder_id, "deleted")
    try:
        delete_item(sub, "MAINTENANCE#" + reminder_id,
                    condition=Attr("PK").exists() & Attr("status").eq("pending"))
    except ClientError as error:
        if is_conditional_failure(error):
            raise ApiError(409, "CONFLICT", "This reminder was changed by another request. Refresh and try again.")
        raise
    return 200, {"deleted": True, "id": reminder_id}


def _completion_date(body):
    """The user's local 'today' may differ from UTC by up to a day, so a client date is accepted within one day."""
    today = today_utc()
    raw = body.get("completedDate")
    if raw is None or raw == "":
        return today
    parsed = parse_date(raw) if isinstance(raw, str) else None
    if parsed is None or abs((parsed - today).days) > 1:
        raise ApiError(400, "VALIDATION_ERROR", "The completion date is not valid.",
                       fields={"completedDate": "Use today's date as YYYY-MM-DD."})
    return parsed


def complete_reminder(sub, reminder_id, body):
    existing = _existing_pending(sub, reminder_id, "completed again")
    completed_on = _completion_date(body)
    now = now_iso()

    done = dict(existing)
    done.update({"status": "completed", "completedDate": completed_on.isoformat(), "updatedAt": now})
    ops = [put_op(done, condition="attribute_exists(PK) AND #s = :pending",
                  names={"#s": "status"}, values={":pending": "pending"})]

    next_item = None
    due_next = next_due_date(parse_date(existing["dueDate"]), existing["repeat"],
                             int(existing.get("anchorDay", 0)) or None, completed_on)
    if due_next is not None:
        next_id = str(uuid.uuid5(NEXT_OCCURRENCE_NAMESPACE, existing["seriesId"] + ":" + due_next.isoformat()))
        if get_item(sub, "MAINTENANCE#" + next_id) is None:
            next_item = dict(existing)
            next_item.pop("completedDate", None)
            next_item.update({"SK": "MAINTENANCE#" + next_id, "id": next_id, "dueDate": due_next.isoformat(),
                              "status": "pending", "createdAt": now, "updatedAt": now})
            ops.append(put_op(next_item, condition="attribute_not_exists(PK)"))

    transact(ops)
    return 200, {"completed": to_public(done), "next": to_public(next_item) if next_item else None}
