"""Operator-owned synthetic authorization; Python standard library only.
Run: python python-access-provider.py records.json [loopback-port].
Set ACCESS_PROVIDER_TOKEN; ACCESS_PROVIDER_ID defaults to example.access.
POST digital-card-access-provider@1 to /access-provider. This service resolves
already authenticated issuer/subject/userId identities; it does not log users in.
Records: {"identities":[{"issuer":"https://issuer.test","subject":"collector",
"userId":"collector","status":"allowed","role":"player",
"permissions":["art.import"]}]}. Denied/disabled records omit role/permissions.
Unknown identities are denied. The bounded fixture is reread for every request;
replace it atomically to change or disable access. Keep records operator-owned.
Admin requires an explicit record and independent host approval of all authority.
"""
import hmac
import json
import os
import re
import sys
import time
from decimal import Decimal, InvalidOperation
from http.server import BaseHTTPRequestHandler, HTTPServer

PROVIDER = os.environ.get("ACCESS_PROVIDER_ID", "example.access")
TOKEN = os.environ.get("ACCESS_PROVIDER_TOKEN", "")
MAX_INTEGER = 9007199254740991
IDENTIFIER = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}")
UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")
RESERVED = {"__proto__", "constructor", "prototype"}
PERMISSIONS = frozenset(['admin.read', 'admin.manage', 'admin.cards', 'catalog.read', 'card-policies.read', 'card-policies.manage', 'card-stats.provide', 'catalog.preview', 'catalog.publish', 'accounts.register', 'currency.grant', 'currency.settle', 'audit.read', 'events.read', 'maintenance.run', 'trading.manage', 'actions.manage', 'actions.dispatch', 'commerce.manage', 'raffles.draw', 'codes.manage', 'bindings.manage', 'codes.import', 'codes.confirm', 'art.import', 'art.review', 'art.publish', 'art.moderate'])
NAMES = "protocol operation scope requestId providerId grantId generation deadline issuer subject userId"


def identifier(value):
    return isinstance(value, str) and IDENTIFIER.fullmatch(value) is not None and value not in RESERVED


def uuid(value):
    return isinstance(value, str) and UUID.fullmatch(value) is not None


def integer(value, minimum=1, maximum=MAX_INTEGER):
    return type(value) is int and minimum <= value <= maximum


def fields(value, names):
    return isinstance(value, dict) and set(value) == set(names.split())


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("Duplicate property")
        result[key] = value
    return result


def unicode_strings(value):
    if isinstance(value, str):
        value.encode("utf-8")
    elif isinstance(value, dict):
        for key, item in value.items():
            unicode_strings(key)
            unicode_strings(item)
    elif isinstance(value, list):
        for item in value:
            unicode_strings(item)


def exact_integer(token):
    try:
        value = Decimal(token)
        if not value.is_finite() or value.copy_abs() > MAX_INTEGER or value != value.to_integral_value():
            raise ValueError("Invalid integer")
        return int(value)
    except InvalidOperation as error:
        raise ValueError("Invalid integer") from error


def parse(raw):
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                       parse_float=exact_integer,
                       parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
    unicode_strings(value)
    return value


def text(value, maximum):
    return (isinstance(value, str) and 1 <= len(value) <= maximum
            and not re.search(r"[\x00-\x1f\x7f]", value))


def valid_identity(value):
    return text(value["issuer"], 2000) and text(value["subject"], 512) and identifier(value["userId"])


def validate(request):
    if (not fields(request, NAMES) or request["protocol"] != "digital-card-access-provider@1"
            or request["operation"] != "resolveAccess" or request["scope"] != "access"
            or request["providerId"] != PROVIDER or not uuid(request["requestId"])
            or not uuid(request["grantId"]) or not integer(request["generation"])
            or not integer(request["deadline"]) or not valid_identity(request)):
        raise ValueError()


def load_records():
    with open(sys.argv[1], "rb") as source:
        raw = source.read(65537)
    if len(raw) > 65536:
        raise ValueError()
    records = parse(raw)
    if not fields(records, "identities") or not isinstance(records["identities"], list) or len(records["identities"]) > 100:
        raise ValueError()
    result = {}
    for record in records["identities"]:
        if not isinstance(record, dict) or record.get("status") not in ("allowed", "denied", "disabled"):
            raise ValueError()
        expected = "issuer subject userId status" + (" role permissions" if record["status"] == "allowed" else "")
        if not fields(record, expected) or not valid_identity(record):
            raise ValueError()
        key = (record["issuer"], record["subject"], record["userId"])
        if key in result:
            raise ValueError()
        if record["status"] == "allowed":
            if (record["role"] not in ("player", "admin") or not isinstance(record["permissions"], list)
                    or len(record["permissions"]) > len(PERMISSIONS)
                    or not all(isinstance(item, str) and item in PERMISSIONS for item in record["permissions"])
                    or len(set(record["permissions"])) != len(record["permissions"])):
                raise ValueError()
        result[key] = {key: value for key, value in record.items() if key not in ("issuer", "subject", "userId")}
    return result


class Provider(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_args):
        pass

    def reply(self, status, value):
        raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
        if len(raw) > 32768:
            status, raw = 500, b"{}"
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(raw)
        self.close_connection = True

    def do_POST(self):
        try:
            length = self.headers.get("Content-Length", "")
            if (self.path != "/access-provider" or self.headers.get("Transfer-Encoding")
                    or len(self.headers.get_all("Content-Length", [])) != 1
                    or len(self.headers.get_all("Content-Type", [])) != 1
                    or self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json"
                    or not re.fullmatch(r"[0-9]+", length) or not 0 < int(length) <= 65536):
                raise ValueError()
            raw = self.rfile.read(int(length))
            if len(raw) != int(length):
                raise ValueError()
            request = parse(raw)
            validate(request)
        except (ValueError, TypeError, UnicodeError, TimeoutError, RecursionError):
            self.reply(400, {})
            return
        if (len(self.headers.get_all("Authorization", [])) != 1
                or not hmac.compare_digest(self.headers.get("Authorization", "").encode("utf-8"), ("Bearer " + TOKEN).encode("utf-8"))):
            self.reply(401, {**request, "status": "error", "errorCode": "unauthenticated"})
            return
        try:
            if request["deadline"] <= int(time.time() * 1000):
                raise ValueError()
            records = load_records()
        except (OSError, ValueError, TypeError, UnicodeError, RecursionError):
            self.reply(503, {**request, "status": "error", "errorCode": "unavailable"})
            return
        decision = records.get((request["issuer"], request["subject"], request["userId"]), {"status": "denied"})
        self.reply(200, {**request, **decision})


if not identifier(PROVIDER) or not 16 <= len(TOKEN) <= 4096 or not re.fullmatch(r"[\x21-\x7e]+", TOKEN):
    raise SystemExit("Invalid access provider configuration")
try:
    load_records()
    server = HTTPServer(("127.0.0.1", int(sys.argv[2]) if len(sys.argv) > 2 else 0), Provider)
except (OSError, ValueError, TypeError, UnicodeError, IndexError, RecursionError):
    raise SystemExit("Invalid access provider configuration")
print(server.server_port, flush=True)
server.serve_forever()
