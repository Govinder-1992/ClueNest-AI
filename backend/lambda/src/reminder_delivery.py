"""ClueNest AI - Sends the maintenance reminder e-mail of ONE user through Amazon SNS.
Used by maintenance_reminders.py (the daily EventBridge check). Rules, in order:
 1. The user must have opted in (item PK = USER#<sub>, SK = PREFS#notifications, p_maintenanceEmail true).
 2. The user's own topic is computed from the user ID (TOPIC_ARN_PREFIX + sub). It is never read from the
    database, so a bad record cannot point the e-mail at someone else's topic.
 3. That topic must have a CONFIRMED e-mail subscription. A pending (unconfirmed), expired or unsubscribed
    address gets nothing.
 4. Each reminder is claimed in a notification ledger BEFORE sending: one item per reminder and due date,
    PK = USER#<sub>, SK = NOTIFY#<reminderId>#<dueDate>. The claim is one conditional write, so two
    runs at the same time cannot both send it. Ledger attributes all start with "n_", so IAM can allow
    this function to write only those, and the reminder itself is never changed.
 5. Only after SNS accepts the message is the ledger marked "sent". A failure marks it "failed" with a
    retry time (the next daily run retries it, up to MAX_ATTEMPTS times), or "abandoned".
 A crash after SNS accepts the message but before the mark can send one duplicate once the lease runs
 out (SNS has no idempotency key). Ledger items expire after a year (DynamoDB TTL).
Nothing personal is logged: no user ID, e-mail address, topic, task or appliance name.
"""
import logging
import os
import re
import time
import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config
from botocore.exceptions import ClientError
from cluenest_common import is_conditional_failure, pk_for, table

LOG = logging.getLogger()
PREFS_SK = "PREFS#notifications"
TOPIC_SUB_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")
LEASE_SECONDS = 300
MAX_ATTEMPTS = 4
BACKOFF_SECONDS = 3600                   # first retry after 1 hour, then 4 hours, then 16 hours (never more than a day)
PERMANENT_ERRORS = ("NotFound", "NotFoundException", "AuthorizationError")
MAX_PER_EMAIL = 25                       # reminders in one e-mail. The rest go out on the next run.
LEDGER_TTL_SECONDS = 365 * 24 * 3600
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]+")
_sns = None


def sns():
    global _sns
    if _sns is None:
        _sns = boto3.client("sns", config=Config(connect_timeout=2, read_timeout=5, retries={"total_max_attempts": 2, "mode": "standard"}))
    return _sns


def now_epoch():
    return int(time.time())


def configured():
    return bool(os.environ.get("TOPIC_ARN_PREFIX"))


# ---------------------------------------------------------------- opt-in and subscription checks
def opted_in(sub):
    item = table().get_item(Key={"PK": pk_for(sub), "SK": PREFS_SK}, ProjectionExpression="p_maintenanceEmail", ConsistentRead=True).get("Item") or {}
    return item.get("p_maintenanceEmail") is True


def has_confirmed_subscription(topic_arn):
    token = None
    while True:
        kwargs = {"TopicArn": topic_arn}
        if token:
            kwargs["NextToken"] = token
        page = sns().list_subscriptions_by_topic(**kwargs)
        for s in page.get("Subscriptions", []):
            if s.get("Protocol") == "email" and str(s.get("SubscriptionArn", "")).startswith("arn:"):
                return True
        token = page.get("NextToken")
        if not token:
            return False


# ---------------------------------------------------------------- the ledger
def ledger_key(sub, reminder_id, due_date):
    return {"PK": pk_for(sub), "SK": "NOTIFY#%s#%s" % (reminder_id, due_date)}


def finished(sub):
    """SK of this user's ledger items that are final (sent or abandoned), so they are not even attempted again."""
    done, start = set(), None
    while True:
        kwargs = {"KeyConditionExpression": Key("PK").eq(pk_for(sub)) & Key("SK").begins_with("NOTIFY#"),
                  "ProjectionExpression": "SK, n_state", "ConsistentRead": True}
        if start:
            kwargs["ExclusiveStartKey"] = start
        page = table().query(**kwargs)
        done.update(i["SK"] for i in page.get("Items", []) if i.get("n_state") in ("sent", "abandoned"))
        start = page.get("LastEvaluatedKey")
        if not start:
            return done


def claim(sub, reminder_id, due_date, now):
    """Win the right to notify this reminder, or return None. Returns the attempt number when claimed."""
    try:
        result = table().update_item(
            Key=ledger_key(sub, reminder_id, due_date),
            UpdateExpression=("SET n_state = :sending, n_leaseUntil = :lease, n_type = :type, n_userId = :u, n_reminderId = :r, "
                              "n_dueDate = :d, n_expiresAt = :exp ADD n_attempts :one"),
            ConditionExpression=("attribute_not_exists(PK) OR (n_state = :failed AND n_nextAttemptAt <= :now AND n_attempts < :max) "
                                 "OR (n_state = :sending AND n_leaseUntil < :now)"),
            ExpressionAttributeValues={":sending": "sending", ":failed": "failed", ":lease": now + LEASE_SECONDS, ":type": "NOTIFICATION",
                                       ":u": sub, ":r": reminder_id, ":d": due_date, ":exp": now + LEDGER_TTL_SECONDS,
                                       ":one": 1, ":now": now, ":max": MAX_ATTEMPTS},
            ReturnValues="UPDATED_NEW")
    except ClientError as error:
        if is_conditional_failure(error):
            return None                                           # already sent, abandoned, in progress, or not time to retry yet
        raise
    return int(result["Attributes"]["n_attempts"])


def _finish(sub, claimed, sets, values):
    """Update claimed ledger items, but only while OUR claim (state and attempt number) still stands."""
    for reminder_id, due_date, attempt in claimed:
        try:
            table().update_item(
                Key=ledger_key(sub, reminder_id, due_date), UpdateExpression=sets + " REMOVE n_leaseUntil",
                ConditionExpression="n_state = :sending AND n_attempts = :a",
                ExpressionAttributeValues=dict(values, **{":sending": "sending", ":a": attempt}))
        except ClientError as error:
            if not is_conditional_failure(error):
                raise


def mark_sent(sub, claimed, message_id, now):
    _finish(sub, claimed, "SET n_state = :sent, n_sentAt = :t, n_messageId = :m",
            {":sent": "sent", ":t": now, ":m": str(message_id)[:100]})


def mark_failed(sub, claimed, code, now):
    retry, give_up = [], []
    for item in claimed:
        (give_up if item[2] >= MAX_ATTEMPTS else retry).append(item)
    code = str(code)[:60]
    if retry:                                                     # attempts differ per item, so the retry time is set per item
        for item in retry:
            wait = min(BACKOFF_SECONDS * 4 ** (item[2] - 1), 24 * 3600)
            _finish(sub, [item], "SET n_state = :failed, n_errorCode = :c, n_nextAttemptAt = :next",
                    {":failed": "failed", ":c": code, ":next": now + wait})
    if give_up:
        _finish(sub, give_up, "SET n_state = :ab, n_errorCode = :c", {":ab": "abandoned", ":c": code})


def mark_abandoned(sub, claimed, code):
    _finish(sub, claimed, "SET n_state = :ab, n_errorCode = :c", {":ab": "abandoned", ":c": str(code)[:60]})


# ---------------------------------------------------------------- the message
def clean(text, limit):
    return CONTROL_RE.sub(" ", str(text or "")).strip()[:limit]


def compose(reminders, app_url):
    """(subject, message) for one user. The user's own task and appliance names, plain text."""
    n = len(reminders)
    subject = "ClueNest: %d maintenance reminder%s due" % (n, "" if n == 1 else "s")
    lines = ["These maintenance reminders are due or overdue:", ""]
    for r in sorted(reminders, key=lambda x: (x.get("dueDate", ""), x.get("taskName", ""))):
        appliance = clean(r.get("applianceName"), 80)
        lines.append("- %s%s, due %s" % (clean(r.get("taskName"), 100) or "Maintenance task",
                                         " (%s)" % appliance if appliance else "", clean(r.get("dueDate"), 10)))
    lines += ["", "Open ClueNest: %s/#/maintenance" % app_url.rstrip("/"),
              "", "You are receiving this because you turned on maintenance e-mail reminders in ClueNest Settings.",
              "To stop, turn them off in Settings or use the unsubscribe link below."]
    return subject, "\n".join(lines)


# ---------------------------------------------------------------- one user
def deliver_user(sub, reminders, now=None):
    """Returns one of: not_opted_in, no_subscription, nothing_new, sent, failed. Never raises for a normal failure."""
    now = now or now_epoch()
    if not TOPIC_SUB_RE.fullmatch(sub) or not opted_in(sub):
        return "not_opted_in"
    topic_arn = os.environ["TOPIC_ARN_PREFIX"] + sub
    try:
        if not has_confirmed_subscription(topic_arn):
            return "no_subscription"
    except ClientError as error:
        LOG.warning("SNS check failed: %s", error.response.get("Error", {}).get("Code", ""))
        return "no_subscription"                                  # nothing is claimed, so the next run tries again
    done = finished(sub)
    claimed, chosen = [], []
    for r in sorted(reminders, key=lambda x: (x.get("dueDate", ""), x.get("id", ""))):
        if len(claimed) >= MAX_PER_EMAIL:
            break
        if ledger_key(sub, r["id"], r["dueDate"])["SK"] in done:
            continue
        attempt = claim(sub, r["id"], r["dueDate"], now)
        if attempt is not None:
            claimed.append((r["id"], r["dueDate"], attempt))
            chosen.append(r)
    if not claimed:
        return "nothing_new"
    subject, message = compose(chosen, os.environ.get("APP_URL", ""))
    try:
        reply = sns().publish(TopicArn=topic_arn, Subject=subject, Message=message)
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "Unknown")
        LOG.warning("SNS publish failed: %s", code)
        if code in PERMANENT_ERRORS:                              # the topic is gone (the user turned e-mail off) or not allowed: retrying cannot help
            mark_abandoned(sub, claimed, code)
        else:
            mark_failed(sub, claimed, code, now)
        return "failed"
    except Exception as error:                                    # timeouts and connection problems
        LOG.warning("SNS publish failed: %s", type(error).__name__)
        mark_failed(sub, claimed, type(error).__name__, now)
        return "failed"
    mark_sent(sub, claimed, reply.get("MessageId", ""), now)
    return "sent"
