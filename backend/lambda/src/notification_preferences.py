"""ClueNest AI - Notification preferences function (maintenance reminder e-mails through Amazon SNS).
    GET /notifications/preferences     the user's current setting and e-mail confirmation status
    PUT /notifications/preferences     body {"maintenanceEmail": true | false}: turn e-mail reminders on or off
How delivery stays private: every user who opts in gets THEIR OWN SNS topic, named
ClueNestReminders-<environment>-<sub>. Only that user's e-mail address is ever subscribed to it, so
anything published to it can reach nobody else. There is no shared topic and no filter policy.
Nothing is sent until the user opts in AND confirms: SNS e-mails a confirmation link to the address and
the subscription stays "pending" until the user clicks it. Pending subscriptions expire after 48 hours.
The address always comes from Cognito (the user's own verified e-mail), never from the request, so
nobody can subscribe someone else's address.
The setting is stored as one DynamoDB item per user: PK = USER#<sub>, SK = PREFS#notifications.
Its attributes all start with "p_", which lets IAM allow this function to touch only those attributes.
Turning off first records "off" (so delivery stops at once), then removes the subscription and deletes
the topic.
"""
import logging
import os
import re
import time
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError
from cluenest_common import ApiError, get_method, now_iso, parse_body, pk_for, run, table

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)
PREFS_SK = "PREFS#notifications"
TOPIC_SUB_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")          # characters an SNS topic name allows
EMAIL_RE = re.compile(r"^[^\s@]{1,64}@[^\s@]{1,255}$")
RESUBSCRIBE_COOLDOWN_SECONDS = 300
PREF_ATTRS = "p_maintenanceEmail, p_lastSubscribeAt"
def busy():
    return ApiError(503, "NOTIFICATIONS_UNAVAILABLE", "Notification settings are temporarily unavailable. Please try again later.")



_clients = {}


def client(name):
    if name not in _clients:
        _clients[name] = boto3.client(name, config=Config(connect_timeout=2, read_timeout=5, retries={"total_max_attempts": 2, "mode": "standard"}))
    return _clients[name]


def handler(event, context):
    return run(event, route)


def route(event, sub):
    method = get_method(event)
    if method == "GET":
        return 200, view(sub, read_prefs(sub))
    if method == "PUT":
        return 200, change(sub, parse_body(event))
    raise ApiError(405, "METHOD_NOT_ALLOWED", "This operation is not supported.")


# ---------------------------------------------------------------- the stored setting
def read_prefs(sub):
    item = table().get_item(Key={"PK": pk_for(sub), "SK": PREFS_SK}, ProjectionExpression=PREF_ATTRS, ConsistentRead=True).get("Item") or {}
    return {"enabled": item.get("p_maintenanceEmail") is True, "lastSubscribeAt": int(item.get("p_lastSubscribeAt", 0))}


def write_prefs(sub, enabled, subscribed_now=False):
    now = now_iso()
    names = {"#t": "p_type", "#u": "p_userId", "#e": "p_maintenanceEmail", "#m": "p_updatedAt", "#c": "p_requestedAt", "#l": "p_lastSubscribeAt"}
    values = {":t": "NOTIFICATION_PREFS", ":u": sub, ":e": bool(enabled), ":m": now}
    expr = "SET #t = :t, #u = :u, #e = :e, #m = :m, #c = if_not_exists(#c, :m)"
    if subscribed_now:
        expr += ", #l = :l"
        values[":l"] = int(time.time())
    else:
        names.pop("#l")
    table().update_item(Key={"PK": pk_for(sub), "SK": PREFS_SK}, UpdateExpression=expr,
                        ExpressionAttributeNames=names, ExpressionAttributeValues=values)


# ---------------------------------------------------------------- SNS and Cognito
def topic_arn(sub):
    """The ONE topic that belongs to this user. Computed from the user ID, never read from the request or the database."""
    prefix = os.environ.get("TOPIC_ARN_PREFIX", "")
    if not prefix:
        raise ApiError(501, "NOT_CONFIGURED", "E-mail reminders are not available yet.")
    if not TOPIC_SUB_RE.fullmatch(sub):
        raise ApiError(400, "NOT_SUPPORTED", "E-mail reminders are not available for this account.")
    return prefix + sub


def subscription_status(arn):
    """'active' (a confirmed e-mail subscription), 'pending' (waiting for the user to confirm) or 'none'."""
    found = {"pending": False, "active": False}
    token = None
    try:
        while True:
            kwargs = {"TopicArn": arn}
            if token:
                kwargs["NextToken"] = token
            page = client("sns").list_subscriptions_by_topic(**kwargs)
            for s in page.get("Subscriptions", []):
                if s.get("Protocol") != "email":
                    continue
                if s.get("SubscriptionArn") == "PendingConfirmation":
                    found["pending"] = True
                elif str(s.get("SubscriptionArn", "")).startswith("arn:"):
                    found["active"] = True
            token = page.get("NextToken")
            if not token:
                break
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        if code in ("NotFound", "NotFoundException"):
            return "none"
        LOG.warning("SNS error: %s", code)
        raise busy()
    return "active" if found["active"] else "pending" if found["pending"] else "none"


def verified_email(sub):
    """The user's own verified e-mail address from Cognito. The username of this pool is the user ID."""
    try:
        user = client("cognito-idp").admin_get_user(UserPoolId=os.environ["USER_POOL_ID"], Username=sub)
    except ClientError as error:
        LOG.warning("Cognito error: %s", error.response.get("Error", {}).get("Code", ""))
        raise busy()
    attrs = {a["Name"]: a["Value"] for a in user.get("UserAttributes", [])}
    email = attrs.get("email", "")
    if not user.get("Enabled", False) or not EMAIL_RE.fullmatch(email) or attrs.get("email_verified") != "true":
        raise ApiError(409, "EMAIL_NOT_VERIFIED", "Your account has no verified e-mail address, so reminders can't be sent.")
    return email


# ---------------------------------------------------------------- the two operations
def view(sub, prefs):
    if not prefs["enabled"]:
        return {"maintenanceEmail": {"enabled": False, "status": "off"}}
    status = subscription_status(topic_arn(sub))
    return {"maintenanceEmail": {"enabled": True, "status": {"active": "active", "pending": "pending", "none": "needs_attention"}[status]}}


def change(sub, body):
    wanted = body.get("maintenanceEmail")
    if not isinstance(wanted, bool):
        raise ApiError(400, "VALIDATION_ERROR", "Some fields are invalid. Please correct them and try again.",
                       fields={"maintenanceEmail": "Send true or false."})
    arn = topic_arn(sub)
    prefs = read_prefs(sub)
    return turn_on(sub, arn, prefs) if wanted else turn_off(sub, arn)


def turn_on(sub, arn, prefs):
    status = subscription_status(arn) if prefs["enabled"] else "none"
    if status in ("active", "pending"):                         # nothing to do, and no second confirmation e-mail
        return view(sub, prefs)
    if time.time() - prefs["lastSubscribeAt"] < RESUBSCRIBE_COOLDOWN_SECONDS:
        raise ApiError(429, "TOO_SOON", "Please wait a few minutes before turning this on again.")
    email = verified_email(sub)
    try:
        created = client("sns").create_topic(Name=arn.rsplit(":", 1)[1], Attributes={"DisplayName": "ClueNest"})["TopicArn"]
        if created != arn:                                      # never subscribe anyone to a topic that is not this user's own
            LOG.error("Unexpected topic name")
            raise busy()
        client("sns").subscribe(TopicArn=arn, Protocol="email", Endpoint=email, ReturnSubscriptionArn=True)
    except ClientError as error:
        LOG.warning("SNS error: %s", error.response.get("Error", {}).get("Code", ""))
        raise busy()
    write_prefs(sub, True, subscribed_now=True)
    return {"maintenanceEmail": {"enabled": True, "status": "pending"}}


def turn_off(sub, arn):
    write_prefs(sub, False)                                     # first: delivery stops even if the clean-up below fails
    try:
        client("sns").delete_topic(TopicArn=arn)                # removes every subscription of the topic, confirmed or pending
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        if code not in ("NotFound", "NotFoundException"):
            LOG.warning("SNS error: %s", code)
            raise busy()
    return {"maintenanceEmail": {"enabled": False, "status": "off"}}
