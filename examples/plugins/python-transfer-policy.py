"""Read-only synthetic transfer and trade eligibility; Python standard library only.

Run: python python-transfer-policy.py records.json [loopback-port]
Set TRANSFER_POLICY_TOKEN; TRANSFER_POLICY_PROVIDER_ID defaults to example.transfer.
Records: {"actors": [{"id": "alice", "recipientIds": ["bob"],
"allowListingReservation": true}]}. Every transfer leg or trade sender must have an
explicit actor record and allowed recipient. Null transfer destinations require the
actor's explicit listing reservation permission. Unconfigured requests are denied.
POST both v1 protocols to /transfer-policy. This fixture never allocates copies,
changes ownership, processes payments or modifies records.
"""
import hmac
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PROVIDER = os.environ.get("TRANSFER_POLICY_PROVIDER_ID", "example.transfer")
TOKEN = os.environ["TRANSFER_POLICY_TOKEN"]
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


def ids(value, minimum=0):
    return (isinstance(value, list) and minimum <= len(value) <= 2000
            and all(uuid(item) for item in value) and len(set(value)) == len(value))


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
    if (not fields(record, "id recipientIds allowListingReservation") or not identifier(record["id"])
            or record["id"] in actors or type(record["allowListingReservation"]) is not bool
            or not isinstance(record["recipientIds"], list) or len(record["recipientIds"]) > 100
            or not all(identifier(item) for item in record["recipientIds"])
            or len(set(record["recipientIds"])) != len(record["recipientIds"])):
        raise ValueError("Invalid actor record")
    actors[record["id"]] = (frozenset(record["recipientIds"]), record["allowListingReservation"])


def offer(value):
    if (not fields(value, "copyIds currencies") or not ids(value["copyIds"])
            or not isinstance(value["currencies"], list) or len(value["currencies"]) > 100):
        return False
    return all(fields(item, "currencyId amount") and identifier(item["currencyId"])
               and integer(item["amount"], 0) for item in value["currencies"])


def validate(request):
    if not fields(request, "protocol operation scope phase requestId providerId grantId generation commandId inputDigest snapshotDigest deadline context"):
        raise ValueError()
    if (request["providerId"] != PROVIDER or not uuid(request["requestId"]) or not uuid(request["grantId"])
            or not integer(request["generation"]) or not integer(request["deadline"])
            or not all(isinstance(request[key], str) and DIGEST.fullmatch(request[key]) for key in ("commandId", "inputDigest", "snapshotDigest"))):
        raise ValueError()
    context = request["context"]
    if request["operation"] == "canTransfer":
        if (request["protocol"] != "digital-card-transfer-policy@1" or request["scope"] != "transfer"
                or request["phase"] not in ("review", "propose", "counter", "accept", "list", "quote", "purchase")
                or not fields(context, "channel legs") or context["channel"] not in ("trade", "sale")
                or not isinstance(context["legs"], list) or not 1 <= len(context["legs"]) <= 2):
            raise ValueError()
        combined = []
        for leg in context["legs"]:
            if (not fields(leg, "fromUserId toUserId copyIds versions") or not identifier(leg["fromUserId"])
                    or (leg["toUserId"] is not None and not identifier(leg["toUserId"]))
                    or not ids(leg["copyIds"], 1) or not isinstance(leg["versions"], list)
                    or len(leg["versions"]) != len(leg["copyIds"]) or not all(integer(item) for item in leg["versions"])):
                raise ValueError()
            combined.extend(leg["copyIds"])
        if len(combined) > 2000 or len(set(combined)) != len(combined):
            raise ValueError()
        return [(leg["fromUserId"], leg["toUserId"]) for leg in context["legs"]]
    if request["operation"] == "canTrade":
        names = {"channel", "fromUserId", "toUserId", "give", "receive"}
        if (request["protocol"] != "digital-card-trade-policy@1" or request["scope"] != "exchange"
                or request["phase"] not in ("review", "propose", "counter", "accept", "quote", "purchase")
                or not isinstance(context, dict) or not names <= set(context) or set(context) - names - {"expiresInSeconds"}
                or context["channel"] not in ("trade", "sale") or not identifier(context["fromUserId"])
                or not identifier(context["toUserId"]) or not offer(context["give"]) or not offer(context["receive"])
                or len(context["give"]["copyIds"]) + len(context["receive"]["copyIds"]) > 2000
                or ("expiresInSeconds" in context and not integer(context["expiresInSeconds"], 1, 604800))):
            raise ValueError()
        return [(context["fromUserId"], context["toUserId"])]
    raise ValueError()


class Policy(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(5)

    def log_message(self, *_args):
        pass

    def reply(self, status, value):
        raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
        if len(raw) > 8192:
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
        if (len(self.headers.get_all("Authorization", [])) != 1
                or not hmac.compare_digest(self.headers.get("Authorization", "").encode("utf-8"), ("Bearer " + TOKEN).encode("utf-8"))):
            self.reply(401, {})
            return
        try:
            length = self.headers.get("Content-Length", "")
            if (self.path != "/transfer-policy" or self.headers.get("Transfer-Encoding")
                    or len(self.headers.get_all("Content-Length", [])) != 1
                    or len(self.headers.get_all("Content-Type", [])) != 1
                    or self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json"
                    or not re.fullmatch(r"[0-9]+", length) or not 0 < int(length) <= 262144):
                raise ValueError()
            raw = self.rfile.read(int(length))
            if len(raw) != int(length):
                raise ValueError()
            request = parse(raw)
            routes = validate(request)
        except (ValueError, TypeError, UnicodeError, TimeoutError, RecursionError):
            self.reply(400, {})
            return
        allowed = True
        for actor, recipient in routes:
            recipients, reservation = actors.get(actor, (frozenset(), False))
            allowed = allowed and (reservation if recipient is None else recipient in recipients)
        result = {key: value for key, value in request.items() if key != "context"}
        result["status"] = "allowed" if allowed else "denied"
        if not allowed:
            result["reasonCode"] = "restricted"
        self.reply(200, result)


server = HTTPServer(("127.0.0.1", int(sys.argv[2]) if len(sys.argv) > 2 else 0), Policy)
print(server.server_port, flush=True)
server.serve_forever()
