"""Google Places (New) client for the technician search.
Endpoint: POST https://places.googleapis.com/v1/places:searchText  (Text Search, Places API New)
Two calls per search:
  1. Resolve the typed city or postal code to coordinates (the Find Technician form has a free text
     location, and Text Search needs coordinates to honour a radius).
  2. Search for repair businesses inside the square that bounds the radius, then keep only the ones
     that really are within the radius (straight-line distance) and sort them nearest first.
Only the standard library is used (nothing extra to package). The API key is sent in the
X-Goog-Api-Key header, never in a URL, so it cannot end up in an error message or a log line.
Nothing in this module logs the key, the location text or business details. Only HTTP status
codes and Google's upper-case error reason codes are logged.
Missing information stays missing: a business without a rating has no "rating" field, and so on.
"""
import json
import logging
import math
import re
import socket
import urllib.error
from urllib.request import Request, urlopen

LOG = logging.getLogger()
SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
REQUEST_TIMEOUT_SECONDS = 7          # per Google call. Two calls fit inside the 25 s Lambda timeout
MAX_RESPONSE_BYTES = 1_000_000
MAX_RESULTS = 20                     # Text Search returns at most 20 places per page
DEFAULT_RADIUS_KM = 25
EARTH_RADIUS_KM = 6371.0088
KM_PER_DEGREE = 111.32

# Only the fields that are used are requested, because Google bills by the fields in the mask.
LOCATION_FIELD_MASK = "places.location,places.formattedAddress"
BUSINESS_FIELD_MASK = ",".join([
    "places.id", "places.displayName", "places.formattedAddress", "places.location", "places.rating",
    "places.userRatingCount", "places.googleMapsUri", "places.websiteUri", "places.nationalPhoneNumber",
    "places.currentOpeningHours.openNow", "places.businessStatus"])

# Appliance types in the frontend's list mapped to a fixed search phrase. Anything else becomes the
# general phrase, so user text never goes into the search text.
SEARCH_TERMS = {
    "refrigerator": "refrigerator repair",
    "washing machine": "washing machine repair",
    "dryer": "dryer repair",
    "dishwasher": "dishwasher repair",
    "oven": "oven repair",
    "microwave": "microwave repair",
    "air conditioner": "air conditioner repair",
}
GENERAL_TERM = "appliance repair"

CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]+")
REASON_RE = re.compile(r"^[A-Z][A-Z0-9_]{2,60}$")
QUOTA_REASONS = {"RATE_LIMIT_EXCEEDED", "RESOURCE_EXHAUSTED", "DAILY_LIMIT_EXCEEDED", "QUOTA_EXCEEDED",
                 "RATE_LIMIT_EXCEEDED_PER_MINUTE"}


class PlacesError(Exception):
    """kind: config (key or setup rejected), busy (quota), timeout, unavailable, bad_response, no_location."""
    def __init__(self, kind):
        super().__init__(kind)
        self.kind = kind


# ---------------------------------------------------------------- helpers
def search_term(appliance_type):
    return SEARCH_TERMS.get(str(appliance_type or "").strip().lower(), GENERAL_TERM)


def distance_km(lat1, lng1, lat2, lng2):
    """Straight-line (great circle) distance."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def bounding_box(lat, lng, radius_km):
    """Rectangle (low = south-west, high = north-east) that contains the circle."""
    d_lat = radius_km / KM_PER_DEGREE
    d_lng = radius_km / (KM_PER_DEGREE * max(math.cos(math.radians(lat)), 0.05))
    return ({"latitude": max(-90.0, lat - d_lat), "longitude": max(-180.0, lng - d_lng)},
            {"latitude": min(90.0, lat + d_lat), "longitude": min(180.0, lng + d_lng)})


def _error_reason(body):
    """(status, reason) from Google's error JSON. Both are limited to upper-case codes, so no free text is logged."""
    try:
        error = json.loads(body).get("error") or {}
    except (ValueError, AttributeError, TypeError):
        return "", ""
    status = error.get("status") if isinstance(error.get("status"), str) else ""
    reason = ""
    for detail in error.get("details") or []:
        if isinstance(detail, dict) and isinstance(detail.get("reason"), str):
            reason = detail["reason"]
            break
    return (status if REASON_RE.match(status) else ""), (reason if REASON_RE.match(reason) else "")


def _post(api_key, body, field_mask):
    """One Text Search call. Returns the parsed JSON object or raises PlacesError."""
    request = Request(
        SEARCH_URL, data=json.dumps(body).encode("utf-8"), method="POST",
        headers={"Content-Type": "application/json", "X-Goog-Api-Key": api_key, "X-Goog-FieldMask": field_mask})
    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as reply:
            raw = reply.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        try:
            text = error.read(65536).decode("utf-8", "replace")
        except Exception:
            text = ""
        status, reason = _error_reason(text)
        LOG.warning("Google Places error: http=%s status=%s reason=%s", error.code, status or "-", reason or "-")
        if error.code == 429 or status == "RESOURCE_EXHAUSTED" or reason in QUOTA_REASONS:
            raise PlacesError("busy")
        if error.code in (401, 403) or (error.code == 400 and reason.startswith("API_KEY")):
            raise PlacesError("config")
        raise PlacesError("unavailable")
    except (socket.timeout, TimeoutError):
        LOG.warning("Google Places error: timeout")
        raise PlacesError("timeout")
    except urllib.error.URLError as error:
        if isinstance(error.reason, (socket.timeout, TimeoutError)):
            LOG.warning("Google Places error: timeout")
            raise PlacesError("timeout")
        LOG.warning("Google Places error: connection (%s)", type(error.reason).__name__)
        raise PlacesError("unavailable")
    except Exception as error:                      # for example ssl errors, resets, bad status lines
        LOG.warning("Google Places error: %s", type(error).__name__)
        raise PlacesError("unavailable")
    if len(raw) > MAX_RESPONSE_BYTES:
        LOG.warning("Google Places error: response too large")
        raise PlacesError("bad_response")
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        LOG.warning("Google Places error: response is not JSON")
        raise PlacesError("bad_response")
    if not isinstance(data, dict):
        raise PlacesError("bad_response")
    return data


# ---------------------------------------------------------------- reading Google's answer
def _text(value, limit):
    if not isinstance(value, str):
        return ""
    return CONTROL_RE.sub(" ", value).strip()[:limit]


def _link(value):
    value = _text(value, 500)
    return value if re.match(r"^https?://[^\s]+$", value, re.IGNORECASE) else ""


def _coords(place):
    loc = place.get("location")
    if not isinstance(loc, dict):
        return None
    lat, lng = loc.get("latitude"), loc.get("longitude")
    ok = all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (lat, lng))
    if ok and -90 <= lat <= 90 and -180 <= lng <= 180:
        return float(lat), float(lng)
    return None


def _business(place, origin):
    """One result in the shape the frontend reads, or None. Fields Google did not give are left out."""
    if not isinstance(place, dict):
        return None
    if place.get("businessStatus") == "CLOSED_PERMANENTLY":
        return None
    name = place.get("displayName")
    name = _text(name.get("text") if isinstance(name, dict) else None, 200)
    place_id = _text(place.get("id"), 200)
    if not name or not place_id:
        return None
    out = {"placeId": place_id, "name": name}
    address = _text(place.get("formattedAddress"), 300)
    if address:
        out["address"] = address
    phone = _text(place.get("nationalPhoneNumber"), 40)
    if phone:
        out["phone"] = phone
    website = _link(place.get("websiteUri"))
    if website:
        out["website"] = website
    maps = _link(place.get("googleMapsUri"))
    if maps:
        out["mapsUrl"] = maps
    rating = place.get("rating")
    if isinstance(rating, (int, float)) and not isinstance(rating, bool) and 0 <= rating <= 5:
        out["rating"] = float(rating)
    count = place.get("userRatingCount")
    if isinstance(count, int) and not isinstance(count, bool) and count >= 0:
        out["reviewCount"] = count
    hours = place.get("currentOpeningHours")
    if isinstance(hours, dict) and isinstance(hours.get("openNow"), bool):
        out["openNow"] = hours["openNow"]
    coords = _coords(place)
    if coords:
        out["location"] = {"latitude": coords[0], "longitude": coords[1]}
        out["distanceKm"] = round(distance_km(origin[0], origin[1], coords[0], coords[1]), 1)
    return out


# ---------------------------------------------------------------- the search
def resolve_location(api_key, location):
    """(latitude, longitude, label) for the typed location, or PlacesError("no_location")."""
    data = _post(api_key, {"textQuery": location, "pageSize": 1, "languageCode": "en", "regionCode": "CA"},
                 LOCATION_FIELD_MASK)
    places = data.get("places")
    if not isinstance(places, list) or not places:
        raise PlacesError("no_location")
    coords = _coords(places[0]) if isinstance(places[0], dict) else None
    if coords is None:
        raise PlacesError("no_location")
    return coords[0], coords[1], _text(places[0].get("formattedAddress"), 300)


def search_technicians(api_key, location, radius_km=None, appliance_type=None):
    """Repair businesses within radius_km of the location, nearest first. Returns the response body."""
    radius = int(radius_km) if radius_km not in (None, "") else DEFAULT_RADIUS_KM
    lat, lng, label = resolve_location(api_key, location)
    low, high = bounding_box(lat, lng, radius)
    data = _post(api_key, {"textQuery": search_term(appliance_type), "pageSize": MAX_RESULTS, "languageCode": "en",
                           "regionCode": "CA", "locationRestriction": {"rectangle": {"low": low, "high": high}}},
                 BUSINESS_FIELD_MASK)
    places = data.get("places", [])
    if not isinstance(places, list):
        raise PlacesError("bad_response")
    results, seen = [], set()
    for place in places:
        business = _business(place, (lat, lng))
        if business is None or business["placeId"] in seen:
            continue
        if "distanceKm" in business and business["distanceKm"] > radius:
            continue                                  # inside the bounding square but outside the circle
        seen.add(business["placeId"])
        results.append(business)
    results.sort(key=lambda b: (b.get("distanceKm") is None, b.get("distanceKm", 0.0)))
    LOG.info("Places search: candidates=%d returned=%d", len(places), len(results))
    body = {"results": results, "radiusKm": radius, "source": "Google Places"}
    if label:
        body["searchedLocation"] = label
    return body
