"""Shared helpers for the ClueNest AI Lambda functions.

All functions are deployed from the same zip file and use these helpers for
authentication, request parsing, validation, DynamoDB access and JSON responses.

Security rules enforced here:
  * The user ID (the Cognito "sub") comes ONLY from the claims that API Gateway's
    authorizer has already verified. It is never read from the request body,
    query string, path or headers.
  * Every DynamoDB key starts with USER#<sub>, so one user can never read or
    change another user's items.
  * Unexpected errors are logged, but the response never contains internal details.
  * Request bodies are never logged (they contain personal information).
"""

import base64
import calendar
import json
import logging
import os
import re
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation

import boto3
from boto3.dynamodb.conditions import Key
from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)

MAX_BODY_BYTES = 100_000          # largest accepted request body
MAX_LIST_ITEMS = 1000             # most items one list call returns
QUERY_PAGE_SIZE = 500             # items per DynamoDB Query call
MAX_CENTS = 1_000_000_000         # CAD 10,000,000

SUB_RE = re.compile(r"^[A-Za-z0-9._:@-]{1,128}$")   # no "#", so a sub cannot alter a key
ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
MULTILINE_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")  # allows tab, newline

THROTTLE_CODES = {"ProvisionedThroughputExceededException", "ThrottlingException",
                  "RequestLimitExceeded", "TooManyRequestsException"}


# ---------------------------------------------------------------- errors and responses

class ApiError(Exception):
    """An error that is safe to show to the caller."""

    def __init__(self, status, code, message, fields=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields

    def body(self):
        out = {"message": self.message, "code": self.code}
        if self.fields:
            out["fields"] = self.fields
        return out


def _json_default(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError("Cannot serialise %s" % type(value).__name__)


def response(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", "Cache-Control": "no-store"},
        "body": json.dumps(body, default=_json_default, separators=(",", ":")),
    }


def not_found(what):
    return ApiError(404, "NOT_FOUND", "%s was not found." % what)


# ---------------------------------------------------------------- reading the request

def _http(event):
    return (event.get("requestContext") or {}).get("http") or {}


def get_method(event):
    """HTTP method. Works for API Gateway REST (v1) and HTTP API (v2) events."""
    return str(event.get("httpMethod") or _http(event).get("method") or "").upper()


def get_path(event):
    return str(event.get("rawPath") or event.get("path") or "")


def get_claims(event):
    """Claims verified by API Gateway's authorizer (REST: authorizer.claims, HTTP API: authorizer.jwt.claims)."""
    auth = (event.get("requestContext") or {}).get("authorizer") or {}
    jwt = auth.get("jwt")
    if isinstance(jwt, dict) and isinstance(jwt.get("claims"), dict):
        return jwt["claims"]
    if isinstance(auth.get("claims"), dict):
        return auth["claims"]
    return {}


def get_user_sub(event):
    """The signed-in user's Cognito sub. This is the ONLY source of the user ID.
    Only ACCESS tokens are accepted. API Gateway already refuses ID tokens (routes require a scope that
    only access tokens carry); this check keeps that true even if a route is ever left without a scope."""
    claims = get_claims(event)
    sub = claims.get("sub")
    if claims.get("token_use") != "access":
        raise ApiError(401, "UNAUTHENTICATED", "You are not signed in.")
    if not isinstance(sub, str) or not SUB_RE.fullmatch(sub):
        raise ApiError(401, "UNAUTHENTICATED", "You are not signed in.")
    return sub


def get_path_id(event):
    """The {id} path parameter, or None. A malformed id is reported as 'not found'."""
    value = (event.get("pathParameters") or {}).get("id")
    if value is None or value == "":
        return None
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise not_found("That item")
    return value


def get_query(event):
    return event.get("queryStringParameters") or {}


def _reject_constant(name):
    raise ValueError("unsupported JSON constant " + name)


def parse_body(event, required=True):
    """Parse the JSON request body into a dict (numbers with decimals become Decimal)."""
    raw = event.get("body")
    if raw is None or raw == "":
        if required:
            raise ApiError(400, "INVALID_BODY", "A JSON request body is required.")
        return {}
    if event.get("isBase64Encoded"):
        try:
            raw = base64.b64decode(raw, validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError, TypeError):
            raise ApiError(400, "INVALID_BODY", "The request body could not be read.")
    if not isinstance(raw, str):
        raise ApiError(400, "INVALID_BODY", "The request body could not be read.")
    if len(raw.encode("utf-8")) > MAX_BODY_BYTES:
        raise ApiError(413, "BODY_TOO_LARGE", "The request body is too large.")
    try:
        data = json.loads(raw, parse_float=Decimal, parse_constant=_reject_constant)
    except (ValueError, RecursionError):
        raise ApiError(400, "INVALID_BODY", "The request body is not valid JSON.")
    if not isinstance(data, dict):
        raise ApiError(400, "INVALID_BODY", "The request body must be a JSON object.")
    return data


# ---------------------------------------------------------------- dates

def parse_date(text):
    """'YYYY-MM-DD' -> date, or None when the text is not a real calendar date."""
    if not isinstance(text, str) or not DATE_RE.fullmatch(text):
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def today_utc():
    return datetime.now(timezone.utc).date()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def add_months(d, months, anchor_day=None):
    """d plus whole months. The day is kept (or anchor_day), clamped to the month length."""
    index = d.year * 12 + (d.month - 1) + months
    year, month0 = divmod(index, 12)
    month = month0 + 1
    day = min(anchor_day or d.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


# ---------------------------------------------------------------- validation

class Validator:
    """Collects field errors so the caller gets every problem in one response."""

    def __init__(self, body):
        self.body = body
        self.values = {}
        self.errors = {}

    def _fail(self, key, message):
        self.errors.setdefault(key, message)
        return None

    def _present(self, key, required):
        raw = self.body.get(key)
        if raw is None or (isinstance(raw, str) and raw.strip() == ""):
            if required:
                self._fail(key, "This field is required.")
            return None
        return raw

    def text(self, key, max_len, required=False, multiline=False):
        raw = self._present(key, required)
        if raw is None:
            return None
        if not isinstance(raw, str):
            return self._fail(key, "This field must be text.")
        value = raw.strip()
        if len(value) > max_len:
            return self._fail(key, "Keep this under %d characters." % max_len)
        if (MULTILINE_CONTROL_RE if multiline else CONTROL_RE).search(value):
            return self._fail(key, "This field contains characters that are not allowed.")
        self.values[key] = value
        return value

    def choice(self, key, choices, required=True):
        raw = self._present(key, required)
        if raw is None:
            return None
        if not isinstance(raw, str) or raw not in choices:
            return self._fail(key, "Choose one of: " + ", ".join(choices) + ".")
        self.values[key] = raw
        return raw

    def date(self, key, required=True, min_date=None, max_date=None,
             min_message="This date is too far in the past.", max_message="This date is too far ahead."):
        raw = self._present(key, required)
        if raw is None:
            return None
        parsed = parse_date(raw)
        if parsed is None:
            return self._fail(key, "Enter a valid date as YYYY-MM-DD.")
        if min_date is not None and parsed < min_date:
            return self._fail(key, min_message)
        if max_date is not None and parsed > max_date:
            return self._fail(key, max_message)
        self.values[key] = raw
        return raw

    def integer(self, key, low, high, required=True):
        raw = self._present(key, required)
        if raw is None:
            return None
        if isinstance(raw, bool) or not isinstance(raw, int):
            return self._fail(key, "Enter a whole number.")
        if raw < low or raw > high:
            return self._fail(key, "Enter a number from %d to %d." % (low, high))
        self.values[key] = raw
        return raw

    def dollars(self, key, max_dollars):
        """Optional amount in dollars (up to 2 decimals). Stored as whole cents under key + 'Cents'."""
        raw = self._present(key, False)
        if raw is None:
            return None
        if isinstance(raw, bool) or not isinstance(raw, (int, Decimal)):
            return self._fail(key, "Enter an amount in dollars.")
        try:
            amount = Decimal(raw)
            if not amount.is_finite():
                raise InvalidOperation
            if amount < 0:
                return self._fail(key, "The amount cannot be negative.")
            if amount > max_dollars:
                return self._fail(key, "That amount is too large.")
            if amount != amount.quantize(Decimal("0.01")):
                return self._fail(key, "Use at most 2 decimal places.")
        except InvalidOperation:
            return self._fail(key, "Enter an amount in dollars.")
        cents = int(amount * 100)
        self.values[key + "Cents"] = cents
        return cents

    def cents(self, key, max_cents=MAX_CENTS):
        """Optional whole-number amount in cents."""
        raw = self._present(key, False)
        if raw is None:
            return None
        if isinstance(raw, bool) or not isinstance(raw, int):
            return self._fail(key, "Enter a whole number of cents.")
        if raw < 0:
            return self._fail(key, "The amount cannot be negative.")
        if raw > max_cents:
            return self._fail(key, "That amount is too large.")
        self.values[key] = raw
        return raw

    def check(self):
        if self.errors:
            raise ApiError(400, "VALIDATION_ERROR",
                           "Some fields are invalid. Please correct them and try again.",
                           fields=dict(self.errors))


# ---------------------------------------------------------------- DynamoDB

_table = None
_client = None
_serializer = TypeSerializer()


def table_name():
    name = os.environ.get("TABLE_NAME")
    if not name:
        raise RuntimeError("TABLE_NAME environment variable is not set")
    return name


def table():
    global _table
    if _table is None:
        _table = boto3.resource("dynamodb").Table(table_name())
    return _table


def client():
    global _client
    if _client is None:
        _client = boto3.client("dynamodb")
    return _client


def new_id():
    return str(uuid.uuid4())


def pk_for(sub):
    return "USER#" + sub


def get_item(sub, sort_key):
    # Consistent reads, so a record that was just saved is always visible to the next request.
    result = table().get_item(Key={"PK": pk_for(sub), "SK": sort_key}, ConsistentRead=True)
    return result.get("Item")


def put_item(item, condition=None):
    kwargs = {"Item": item}
    if condition is not None:
        kwargs["ConditionExpression"] = condition
    table().put_item(**kwargs)


def delete_item(sub, sort_key, condition=None):
    kwargs = {"Key": {"PK": pk_for(sub), "SK": sort_key}}
    if condition is not None:
        kwargs["ConditionExpression"] = condition
    table().delete_item(**kwargs)


def is_conditional_failure(error):
    return (isinstance(error, ClientError)
            and error.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException")


def query_prefix(sub, prefix):
    """All of this user's items whose sort key starts with prefix. Returns (items, truncated)."""
    items, start = [], None
    while True:
        kwargs = {
            "KeyConditionExpression": Key("PK").eq(pk_for(sub)) & Key("SK").begins_with(prefix),
            "ConsistentRead": True,
            "Limit": QUERY_PAGE_SIZE,
        }
        if start:
            kwargs["ExclusiveStartKey"] = start
        result = table().query(**kwargs)
        items.extend(result.get("Items", []))
        start = result.get("LastEvaluatedKey")
        if len(items) >= MAX_LIST_ITEMS:
            truncated = bool(start) or len(items) > MAX_LIST_ITEMS
            return items[:MAX_LIST_ITEMS], truncated
        if not start:
            return items, False


def put_op(item, condition=None, names=None, values=None):
    """One 'Put' for transact(). Condition values use plain Python types."""
    put = {"TableName": table_name(), "Item": {k: _serializer.serialize(v) for k, v in item.items()}}
    if condition:
        put["ConditionExpression"] = condition
    if names:
        put["ExpressionAttributeNames"] = names
    if values:
        put["ExpressionAttributeValues"] = {k: _serializer.serialize(v) for k, v in values.items()}
    return {"Put": put}


def transact(ops):
    """All-or-nothing write. A cancelled transaction means another request changed the data."""
    try:
        client().transact_write_items(TransactItems=ops)
    except ClientError as error:
        if error.response.get("Error", {}).get("Code") in ("TransactionCanceledException", "TransactionConflictException"):
            raise ApiError(409, "CONFLICT", "This item was changed by another request. Refresh and try again.")
        raise


def load_appliance(sub, appliance_id):
    """The user's own appliance, or None. Another user's id is simply 'not found'."""
    if not isinstance(appliance_id, str) or not ID_RE.fullmatch(appliance_id):
        return None
    return get_item(sub, "APPLIANCE#" + appliance_id)


def appliance_snapshot(appliance):
    """Appliance details copied onto child records so they stay readable on their own."""
    return {
        "applianceId": appliance["id"],
        "applianceName": appliance.get("name", ""),
        "applianceBrand": appliance.get("brand", ""),
        "applianceModel": appliance.get("model", ""),
        "applianceType": appliance.get("type", ""),
    }


def pick(item, keys):
    """Only the listed attributes, so internal ones (PK, SK, userId, ...) never leave the backend."""
    return {k: item[k] for k in keys if k in item}


# ---------------------------------------------------------------- request wrapper

def _internal_error():
    return response(500, {"message": "Something went wrong on our side. Please try again later.",
                          "code": "INTERNAL_ERROR"})


def run(event, route):
    """Authenticate, run route(event, sub) -> (status, body), and turn every outcome into a JSON response."""
    method, path = get_method(event), get_path(event)
    try:
        sub = get_user_sub(event)
        status, body = route(event, sub)
        LOG.info("%s %s -> %s", method, path, status)
        return response(status, body)
    except ApiError as error:
        LOG.info("%s %s -> %s %s", method, path, error.status, error.code)
        return response(error.status, error.body())
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "")
        LOG.exception("AWS error %s on %s %s", code, method, path)
        if code in THROTTLE_CODES:
            return response(503, {"message": "The service is busy. Please try again in a moment.", "code": "BUSY"})
        return _internal_error()
    except Exception:
        LOG.exception("Unhandled error on %s %s", method, path)
        return _internal_error()
