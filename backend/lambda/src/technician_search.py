"""ClueNest AI - Technician search function.
    GET <technician search path>?location=...&radiusKm=...&applianceType=...
Searches for appliance repair businesses with the Google Places API (New), see google_places.py.
The Google API key lives in AWS Secrets Manager (its ARN is in GOOGLE_PLACES_SECRET_ARN) and is read
through cluenest_secrets.py, which caches it. The key is used only for the call to Google. It is never
returned, logged or sent to the browser, and Google's own error text is never passed on.
Only businesses that Google returns are listed. The function does not use the database.
"""
import json
import logging
import os
import re
import cluenest_secrets
import google_places
from cluenest_common import ApiError, CONTROL_RE, get_method, get_query, run
LOG = logging.getLogger()
ALLOWED_RADII_KM = (5, 10, 25, 50)
LOCATION_BAD_RE = re.compile(r"[<>]")
API_KEY_RE = re.compile(r"^[\x21-\x7e]{8,256}$")     # printable characters, no spaces
KEY_FIELDS = ("apiKey", "GOOGLE_PLACES_API_KEY")       # JSON field names accepted in the secret

def handler(event, context):
    return run(event, route)

def route(event, sub):
    if get_method(event) != "GET":
        raise ApiError(405, "METHOD_NOT_ALLOWED", "This operation is not supported.")
    return search(get_query(event))

def validate_query(query):
    """Same rules as the Find Technician form."""
    errors = {}
    location = query.get("location")
    location = location.strip() if isinstance(location, str) else ""
    if not location:
        errors["location"] = "Enter a city or postal code."
    elif len(location) < 2 or len(location) > 100:
        errors["location"] = "Enter between 2 and 100 characters."
    elif CONTROL_RE.search(location) or LOCATION_BAD_RE.search(location):
        errors["location"] = "The location contains characters that are not allowed."
    radius = query.get("radiusKm")
    if radius not in (None, ""):
        if not (isinstance(radius, str) and radius.isdigit() and int(radius) in ALLOWED_RADII_KM):
            errors["radiusKm"] = "Choose a radius of " + ", ".join(str(r) for r in ALLOWED_RADII_KM) + " km."
    appliance_type = query.get("applianceType")
    if appliance_type not in (None, "") and (not isinstance(appliance_type, str) or len(appliance_type) > 50
                                              or CONTROL_RE.search(appliance_type)):
        errors["applianceType"] = "This value is not valid."
    if errors:
        raise ApiError(400, "VALIDATION_ERROR", "Some fields are invalid. Please correct them and try again.",
                       fields=errors)

def load_api_key():
    """The Google Places API key from Secrets Manager. Raises ApiError when it cannot be used.
    The key is returned to the caller only; it is never put in a response or a log."""
    secret_id = os.environ.get("GOOGLE_PLACES_SECRET_ARN", "").strip()
    if not secret_id:
        raise ApiError(501, "NOT_CONFIGURED",
                       "Technician search is not available yet. The Google Places integration has not been configured.")
    try:
        text = cluenest_secrets.get_secret_string(secret_id).strip()
    except cluenest_secrets.SecretNotSet:
        raise ApiError(501, "NOT_CONFIGURED",
                       "Technician search is not available yet. The Google Places integration has not been configured.")
    except cluenest_secrets.SecretUnavailable:
        raise ApiError(503, "SEARCH_UNAVAILABLE",
                       "Technician search is temporarily unavailable. Please try again later.")
    if text.startswith("{"):                                  # also accept {"apiKey": "..."} or {"GOOGLE_PLACES_API_KEY": "..."}
        try:
            data = json.loads(text)
        except ValueError:
            data = None
        text = next((data[k] for k in KEY_FIELDS if isinstance(data, dict) and k in data), None)
    if not isinstance(text, str) or not API_KEY_RE.fullmatch(text):
        LOG.warning("The Google Places secret does not contain a usable key")
        raise ApiError(501, "NOT_CONFIGURED",
                       "Technician search is not available yet. The Google Places integration has not been configured.")
    return text

PLACES_ERRORS = {
    "config": (503, "SEARCH_MISCONFIGURED", "Technician search is not set up correctly. Please try again later."),
    "busy": (503, "SEARCH_BUSY", "Technician search is busy right now. Please try again in a few minutes."),
    "timeout": (504, "SEARCH_TIMEOUT", "Technician search took too long. Please try again."),
    "unavailable": (503, "SEARCH_UNAVAILABLE", "Technician search is temporarily unavailable. Please try again later."),
    "bad_response": (502, "SEARCH_BAD_RESPONSE", "Technician search could not read the answer. Please try again."),
    "no_location": (404, "LOCATION_NOT_FOUND", "That location could not be found. Check the spelling, or try a nearby city or a postal code."),
}


def search(query):
    validate_query(query)
    api_key = load_api_key()
    radius = query.get("radiusKm")
    try:
        body = google_places.search_technicians(
            api_key, query["location"].strip(), int(radius) if radius not in (None, "") else None,
            query.get("applianceType"))
    except google_places.PlacesError as error:
        raise ApiError(*PLACES_ERRORS.get(error.kind, PLACES_ERRORS["unavailable"]))
    return 200, body