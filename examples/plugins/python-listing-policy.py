"""Read-only synthetic canList and canPurchase policy; Python standard library only.

Run: python python-listing-policy.py records.json [loopback-port]
LISTING_POLICY_TOKEN supplies the credential. LISTING_POLICY_PROVIDER_ID defaults to
example.policy. Records: {"actors": [{"id": "alice", "listShopIds": [UUID],
"purchaseListingIds": [UUID]}]}. Unconfigured actors and targets are denied.
POST both v1 protocols to /listing-policy. Decisions only report fixture eligibility;
the framework retains ownership, allocation and payment authority.
"""
import hmac
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PROVIDER = os.environ.get("LISTING_POLICY_PROVIDER_ID", "example.policy")
TOKEN = os.environ["LISTING_POLICY_TOKEN"]
MAX_INTEGER = 9007199254740991
IDENTIFIER = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}")
UUID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")
DIGEST = re.compile(r"[a-f0-9]{64}")
RESERVED = {"__proto__", "constructor", "prototype"}


def identifier(value):
    return isinstance(value, str) and IDENTIFIER.fullmatch(value) is not None and value not in RESERVED


def uuid(value):
    return isinstance(value, str) and UUID.fullmatch(value) is not None


def integer(value, minimum=1, maximum=MAX_INTEGER):
    return type(value) is int and minimum <= value <= maximum


def fields(value, names):
    return isinstance(value, dict) and set(value) == set(names.split())


def ids(value):
    return isinstance(value, list) and 1 <= len(value) <= 1000 and all(uuid(item) for item in value) and len(set(value)) == len(value)


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


def parse(raw):
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                       parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
    unicode_strings(value)
    return value


if not identifier(PROVIDER):
    raise ValueError("Invalid provider identity")
if not 16 <= len(TOKEN) <= 4096 or not re.fullmatch(r"[\x21-\x7e]+", TOKEN):
    raise ValueError("Provider credential required")
with open(sys.argv[1], "rb") as records_file:
    raw_records = records_file.read(65537)
if len(raw_records) > 65536:
    raise ValueError("Fixture records exceed limit")
records = parse(raw_records)
if not fields(records, "actors") or not isinstance(records["actors"], list) or len(records["actors"]) > 100:
    raise ValueError("Invalid fixture records")
actors = {}
for record in records["actors"]:
    if (not fields(record, "id listShopIds purchaseListingIds") or not identifier(record["id"])
            or record["id"] in actors):
        raise ValueError("Invalid actor record")
    for key in ("listShopIds", "purchaseListingIds"):
        targets = record[key]
        if (not isinstance(targets, list) or len(targets) > 100
                or not all(uuid(item) for item in targets) or len(set(targets)) != len(targets)):
            raise ValueError("Invalid allowed targets")
    actors[record["id"]] = {key: frozenset(record[key]) for key in ("listShopIds", "purchaseListingIds")}


def shop(value):
    return (fields(value, "id ownerId kind") and uuid(value["id"])
            and identifier(value["ownerId"]) and value["kind"] in ("admin", "player"))


def price(value):
    return fields(value, "currencyId amount") and identifier(value["currencyId"]) and integer(value["amount"], 0)


def stock(value):
    if not isinstance(value, dict):
        return False
    kind = value.get("kind")
    if kind in ("copies", "packs"):
        return fields(value, "kind ids") and ids(value["ids"])
    name = {"mint-card": "variantId", "mint-pack": "productId", "action": "handler"}.get(kind)
    return bool(name and fields(value, "kind quantity " + name) and identifier(value[name]) and integer(value["quantity"], 1, 1000))


def validate(request):
    if not fields(request, "protocol operation scope phase requestId providerId grantId generation commandId inputDigest snapshotDigest deadline context"):
        raise ValueError()
    if (request["providerId"] != PROVIDER or request["scope"] != "listing"
            or not uuid(request["requestId"]) or not uuid(request["grantId"])
            or not integer(request["generation"]) or not integer(request["deadline"])
            or not all(isinstance(request[key], str) and DIGEST.fullmatch(request[key]) for key in ("commandId", "inputDigest", "snapshotDigest"))):
        raise ValueError()
    context = request["context"]
    if request["operation"] == "canList":
        if (request["protocol"] != "digital-card-listing-policy@1" or request["phase"] != "create"
                or not fields(context, "actor shop price stock") or not fields(context["actor"], "id")
                or not identifier(context["actor"]["id"]) or not shop(context["shop"])
                or not price(context["price"]) or not stock(context["stock"])):
            raise ValueError()
        return context["actor"]["id"], "listShopIds", context["shop"]["id"]
    if request["operation"] == "canPurchase":
        if (request["protocol"] != "digital-card-purchase-policy@1" or request["phase"] not in ("quote", "purchase")
                or not fields(context, "user shop listing quantity unitIds") or not fields(context["user"], "id")
                or not identifier(context["user"]["id"]) or not shop(context["shop"])
                or not fields(context["listing"], "id kind price") or not uuid(context["listing"]["id"])
                or context["listing"]["kind"] not in ("mint-card", "mint-pack", "copies", "packs", "action")
                or not price(context["listing"]["price"]) or not integer(context["quantity"], 1, 1000)
                or not ids(context["unitIds"])):
            raise ValueError()
        return context["user"]["id"], "purchaseListingIds", context["listing"]["id"]
    raise ValueError()


class Policy(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_args):
        pass

    def reply(self, status, value):
        raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(raw)
        self.close_connection = True

    def do_POST(self):
        if (len(self.headers.get_all("Authorization", [])) != 1
                or not hmac.compare_digest(self.headers.get("Authorization", "").encode("utf-8"), ("Bearer " + TOKEN).encode("utf-8"))):
            self.reply(401, {})
            return
        try:
            length = self.headers.get("Content-Length", "")
            if (self.path != "/listing-policy" or self.headers.get("Transfer-Encoding")
                    or len(self.headers.get_all("Content-Length", [])) != 1
                    or len(self.headers.get_all("Content-Type", [])) != 1
                    or self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json"
                    or not re.fullmatch(r"[0-9]+", length) or not 0 < int(length) <= 65536):
                raise ValueError()
            raw = self.rfile.read(int(length))
            if len(raw) != int(length):
                raise ValueError()
            request = parse(raw)
            actor, key, target = validate(request)
        except (ValueError, TypeError, UnicodeError, TimeoutError, RecursionError):
            self.reply(400, {})
            return
        result = {key: value for key, value in request.items() if key != "context"}
        allowed = target in actors.get(actor, {}).get(key, ())
        result["status"] = "allowed" if allowed else "denied"
        if not allowed:
            result["reasonCode"] = "restricted"
        self.reply(200, result)


server = HTTPServer(("127.0.0.1", int(sys.argv[2]) if len(sys.argv) > 2 else 0), Policy)
print(server.server_port, flush=True)
server.serve_forever()
