"""ClueNest AI - Repair history function.

Operations (the route names are chosen in the API Gateway step):
    GET    /repair-history         list the signed-in user's repair records, newest repair first
    POST   /repair-history         add a repair record
    GET    /repair-history/{id}    read one record
    PUT    /repair-history/{id}    replace the editable fields of a record
    DELETE /repair-history/{id}    delete a record

DynamoDB: PK = USER#<sub>, SK = REPAIR#<id>. Only GetItem, PutItem, DeleteItem and Query are used.

Deleting a repair record never touches the appliance. Costs are whole cents (CAD).
Filtering by appliance, status or date and the expense totals are done by the app.
"""

from datetime import timedelta

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

from cluenest_common import (
    ApiError, Validator, add_months, appliance_snapshot, delete_item, get_item, get_method, get_path_id,
    is_conditional_failure, load_appliance, new_id, not_found, now_iso, parse_body, parse_date, pick, pk_for,
    put_item, query_prefix, run, today_utc,
)

STATUSES = ["completed", "in_progress", "not_repaired", "cancelled"]
PUBLIC_KEYS = ["applianceId", "applianceName", "applianceBrand", "applianceModel", "applianceType",
               "problem", "repairDate", "status", "company", "costCents", "additionalCents", "notes",
               "createdAt", "updatedAt"]


def handler(event, context):
    return run(event, route)


def route(event, sub):
    method = get_method(event)
    record_id = get_path_id(event)
    if record_id is None:
        if method == "GET":
            return list_records(sub)
        if method == "POST":
            return create_record(sub, parse_body(event))
    else:
        if method == "GET":
            return get_record(sub, record_id)
        if method == "PUT":
            return update_record(sub, record_id, parse_body(event))
        if method == "DELETE":
            return remove_record(sub, record_id)
    raise ApiError(405, "METHOD_NOT_ALLOWED", "This operation is not supported.")


def validate_record(sub, body):
    """Same rules as the Add Repair Record form, plus: the appliance must be the user's own."""
    today = today_utc()
    v = Validator(body)
    v.text("applianceId", 64, required=True)
    v.text("problem", 1000, required=True, multiline=True)
    v.date("repairDate", required=True, min_date=add_months(today, -600), max_date=today + timedelta(days=1),
           min_message="The repair date is too far in the past.",
           max_message="The repair date cannot be in the future.")
    v.choice("status", STATUSES)
    v.text("company", 100)
    v.cents("costCents")
    v.cents("additionalCents")
    v.text("notes", 1000, multiline=True)
    v.check()
    values = dict(v.values)
    appliance = load_appliance(sub, values["applianceId"])
    if appliance is None:
        raise ApiError(400, "APPLIANCE_NOT_FOUND", "The selected appliance was not found.",
                       fields={"applianceId": "Select one of your appliances."})
    purchased = parse_date(appliance.get("purchaseDate", ""))
    if purchased and parse_date(values["repairDate"]) < purchased:
        raise ApiError(400, "VALIDATION_ERROR", "The repair date is before the appliance was purchased.",
                       fields={"repairDate": "The repair date is before the appliance's purchase date."})
    return values, appliance


def build_record(sub, values, appliance, existing=None):
    now = now_iso()
    record_id = existing["id"] if existing else new_id()
    item = {"PK": pk_for(sub), "SK": "REPAIR#" + record_id, "entityType": "REPAIR",
            "userId": sub, "id": record_id}
    item.update(appliance_snapshot(appliance))
    for key in ("problem", "repairDate", "status", "company", "costCents", "additionalCents", "notes"):
        if key in values:
            item[key] = values[key]
    item["createdAt"] = existing["createdAt"] if existing else now
    item["updatedAt"] = now
    return item


def to_public(item):
    out = {"id": item["id"]}
    out.update(pick(item, PUBLIC_KEYS))
    return out


def list_records(sub):
    items, truncated = query_prefix(sub, "REPAIR#")
    items.sort(key=lambda i: (i.get("repairDate", ""), i.get("createdAt", "")), reverse=True)
    return 200, {"records": [to_public(i) for i in items], "count": len(items), "truncated": truncated}


def create_record(sub, body):
    values, appliance = validate_record(sub, body)
    item = build_record(sub, values, appliance)
    put_item(item, condition=Attr("PK").not_exists())
    return 201, {"record": to_public(item)}


def get_record(sub, record_id):
    item = get_item(sub, "REPAIR#" + record_id)
    if not item:
        raise not_found("The repair record")
    return 200, {"record": to_public(item)}


def update_record(sub, record_id, body):
    values, appliance = validate_record(sub, body)
    existing = get_item(sub, "REPAIR#" + record_id)
    if not existing:
        raise not_found("The repair record")
    item = build_record(sub, values, appliance, existing)
    try:
        put_item(item, condition=Attr("PK").exists())
    except ClientError as error:
        if is_conditional_failure(error):
            raise not_found("The repair record")
        raise
    return 200, {"record": to_public(item)}


def remove_record(sub, record_id):
    try:
        delete_item(sub, "REPAIR#" + record_id, condition=Attr("PK").exists())
    except ClientError as error:
        if is_conditional_failure(error):
            raise not_found("The repair record")
        raise
    return 200, {"deleted": True, "id": record_id}
