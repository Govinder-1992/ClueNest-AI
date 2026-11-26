"""ClueNest AI - Appliances function.

Operations (the route names are chosen in the API Gateway step):
    GET    /appliances         list the signed-in user's appliances
    POST   /appliances         register an appliance
    GET    /appliances/{id}    read one appliance
    PUT    /appliances/{id}    replace the editable fields of an appliance
    DELETE /appliances/{id}    remove an appliance

DynamoDB: PK = USER#<sub>, SK = APPLIANCE#<id>. Only GetItem, PutItem, DeleteItem and Query are used.

Deleting an appliance removes only the appliance item. Repair records, reminders and
troubleshooting history are kept: they carry their own copy of the appliance name.
"""

from datetime import date, timedelta

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError
from decimal import Decimal

from cluenest_common import (
    ApiError, Validator, add_months, delete_item, get_item, get_method, get_path_id, is_conditional_failure,
    new_id, not_found, now_iso, parse_body, parse_date, pick, pk_for, put_item, query_prefix, run, today_utc,
)

APPLIANCE_TYPES = ["Refrigerator", "Washing Machine", "Dryer", "Dishwasher", "Oven",
                   "Microwave", "Air Conditioner", "Other"]
PUBLIC_KEYS = ["name", "type", "brand", "model", "serialNumber", "purchaseDate", "storeName",
               "warrantyYears", "warrantyExpiry", "createdAt", "updatedAt"]
MAX_PRICE_DOLLARS = 10_000_000


def handler(event, context):
    return run(event, route)


def route(event, sub):
    method = get_method(event)
    appliance_id = get_path_id(event)
    if appliance_id is None:
        if method == "GET":
            return list_appliances(sub)
        if method == "POST":
            return create_appliance(sub, parse_body(event))
    else:
        if method == "GET":
            return get_appliance(sub, appliance_id)
        if method == "PUT":
            return update_appliance(sub, appliance_id, parse_body(event))
        if method == "DELETE":
            return remove_appliance(sub, appliance_id)
    raise ApiError(405, "METHOD_NOT_ALLOWED", "This operation is not supported.")


def validate_appliance(body):
    """Same rules as the Add Appliance form. The warranty expiry is always calculated here."""
    today = today_utc()
    v = Validator(body)
    v.text("name", 100, required=True)
    v.choice("type", APPLIANCE_TYPES)
    v.text("brand", 100, required=True)
    v.text("model", 100)
    v.text("serialNumber", 100)
    # One day of slack, so a user ahead of UTC can still enter their own "today".
    v.date("purchaseDate", required=True, min_date=date(1900, 1, 1), max_date=today + timedelta(days=1),
           min_message="This date is too far in the past.",
           max_message="The purchase date cannot be in the future.")
    v.dollars("purchasePrice", MAX_PRICE_DOLLARS)
    v.text("storeName", 100)
    v.integer("warrantyYears", 0, 50)
    v.check()
    values = dict(v.values)
    years = values["warrantyYears"]
    if years > 0:
        values["warrantyExpiry"] = add_months(parse_date(values["purchaseDate"]), 12 * years).isoformat()
    return values


def to_public(item):
    out = {"id": item["id"]}
    out.update(pick(item, PUBLIC_KEYS))
    if "purchasePriceCents" in item:
        out["purchasePrice"] = Decimal(item["purchasePriceCents"]) / 100
    return out


def list_appliances(sub):
    items, truncated = query_prefix(sub, "APPLIANCE#")
    items.sort(key=lambda i: i.get("createdAt", ""), reverse=True)   # newest first
    return 200, {"appliances": [to_public(i) for i in items], "count": len(items), "truncated": truncated}


def create_appliance(sub, body):
    values = validate_appliance(body)
    now = now_iso()
    appliance_id = new_id()
    item = {"PK": pk_for(sub), "SK": "APPLIANCE#" + appliance_id, "entityType": "APPLIANCE",
            "userId": sub, "id": appliance_id}
    item.update(values)
    item.update({"createdAt": now, "updatedAt": now})
    put_item(item, condition=Attr("PK").not_exists())
    return 201, {"appliance": to_public(item)}


def get_appliance(sub, appliance_id):
    item = get_item(sub, "APPLIANCE#" + appliance_id)
    if not item:
        raise not_found("The appliance")
    return 200, {"appliance": to_public(item)}


def update_appliance(sub, appliance_id, body):
    values = validate_appliance(body)
    existing = get_item(sub, "APPLIANCE#" + appliance_id)
    if not existing:
        raise not_found("The appliance")
    item = {"PK": existing["PK"], "SK": existing["SK"], "entityType": "APPLIANCE", "userId": sub,
            "id": appliance_id}
    item.update(values)
    item.update({"createdAt": existing.get("createdAt", now_iso()), "updatedAt": now_iso()})
    try:
        put_item(item, condition=Attr("PK").exists())
    except ClientError as error:
        if is_conditional_failure(error):
            raise not_found("The appliance")
        raise
    return 200, {"appliance": to_public(item)}


def remove_appliance(sub, appliance_id):
    try:
        delete_item(sub, "APPLIANCE#" + appliance_id, condition=Attr("PK").exists())
    except ClientError as error:
        if is_conditional_failure(error):
            raise not_found("The appliance")
        raise
    return 200, {"deleted": True, "id": appliance_id}
