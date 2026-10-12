"""Read-only synthetic currency settlement fixture; Python standard library only.

Run with a JSON records file and optional loopback port (default 0).
CURRENCY_PROVIDER_TOKEN supplies the credential; CURRENCY_PROVIDER_ID defaults to example.points.
Records contain accounts: [{userId, account}] and transactions: [{transactionId, account,
status, currency, amountUnits}]. Only settled transactions have currency and amountUnits;
pending, refunded and unknown transactions contain identity and status alone.
This fixture reports configured evidence and does not process payments or modify records.
"""
import hmac
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

PROTOCOL = "digital-card-currency-settlement@1"
PROVIDER = os.environ.get("CURRENCY_PROVIDER_ID", "example.points")
TOKEN = os.environ["CURRENCY_PROVIDER_TOKEN"]
IDENTIFIER = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}")
REQUEST_ID = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}")
AMOUNT = re.compile(r"[1-9][0-9]{0,39}")
RESERVED = {"__proto__", "constructor", "prototype"}

def identifier(value):
    return isinstance(value, str) and IDENTIFIER.fullmatch(value) is not None and value not in RESERVED

def text(value, maximum):
    if not isinstance(value, str) or not value.strip():
        return False
    # Match JavaScript string bounds and reject unpaired Unicode surrogates.
    return len(value.encode("utf-16-le")) // 2 <= maximum and not re.search(r"[\x00-\x1f\x7f]", value)

if not identifier(PROVIDER):
    raise ValueError("Invalid provider identity")
if not 16 <= len(TOKEN) <= 4096 or not re.fullmatch(r"[\x21-\x7e]+", TOKEN):
    raise ValueError("Provider credential required")

def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("Duplicate property")
        result[key] = value
    return result

def parse(raw):
    return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                      parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))

with open(sys.argv[1], "rb") as records_file:
    raw_records = records_file.read(65537)
if len(raw_records) > 65536:
    raise ValueError("Fixture records exceed limit")
records = parse(raw_records)
if (not isinstance(records, dict) or set(records) != {"accounts", "transactions"}
    or not isinstance(records["accounts"], list) or not isinstance(records["transactions"], list)
    or len(records["accounts"]) > 100 or len(records["transactions"]) > 100):
    raise ValueError("Invalid fixture records")
accounts = {}
owners = set()
for record in records["accounts"]:
    if (not isinstance(record, dict) or set(record) != {"userId", "account"}
        or not text(record["userId"], 100) or not text(record["account"], 300)
        or record["userId"] in accounts or record["account"] in owners):
        raise ValueError("Invalid account record")
    accounts[record["userId"]] = record["account"]
    owners.add(record["account"])
transactions = {}
for record in records["transactions"]:
    if (not isinstance(record, dict) or not text(record.get("transactionId"), 300)
        or not text(record.get("account"), 300) or record["account"] not in owners
        or record.get("status") not in {"settled", "pending", "refunded", "unknown"}
        or record["transactionId"] in transactions):
        raise ValueError("Invalid transaction record")
    fields = {"transactionId", "account", "status"}
    if record["status"] == "settled":
        fields.update({"currency", "amountUnits"})
        if (not identifier(record.get("currency")) or not isinstance(record.get("amountUnits"), str)
            or not AMOUNT.fullmatch(record["amountUnits"])):
            raise ValueError("Invalid settlement record")
    if set(record) != fields:
        raise ValueError("Invalid transaction fields")
    transactions[record["transactionId"]] = record

class Provider(BaseHTTPRequestHandler):
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
            if (self.path != "/currency-settlement" or self.headers.get("Transfer-Encoding")
                or len(self.headers.get_all("Content-Length", [])) != 1
                or len(self.headers.get_all("Content-Type", [])) != 1
                or self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json"
                or not re.fullmatch(r"[0-9]+", length) or not 0 < int(length) <= 8192):
                raise ValueError()
            raw = self.rfile.read(int(length))
            if len(raw) != int(length):
                raise ValueError()
            request = parse(raw)
            if not isinstance(request, dict):
                raise ValueError()
            operation = request.get("operation")
            fields = {"protocol", "operation", "requestId", "providerId"}
            if operation == "resolve-account":
                fields.add("userId")
            elif operation == "lookup":
                fields.update({"transactionId", "account"})
            else:
                raise ValueError()
            if (set(request) != fields or request["protocol"] != PROTOCOL or request["providerId"] != PROVIDER
                or not isinstance(request["requestId"], str) or not REQUEST_ID.fullmatch(request["requestId"])
                or (operation == "resolve-account" and not text(request["userId"], 100))
                or (operation == "lookup" and (not text(request["transactionId"], 300) or not text(request["account"], 300)))):
                raise ValueError()
        except (ValueError, TypeError, UnicodeError, TimeoutError):
            self.reply(400, {})
            return
        result = dict(request)
        if operation == "resolve-account":
            account = accounts.get(request["userId"])
            if account is None:
                result.update({"status": "error", "errorCode": "not-found"})
                self.reply(404, result)
                return
            result.update({"status": "resolved", "account": account})
        else:
            record = transactions.get(request["transactionId"])
            if request["account"] not in owners or (record is not None and record["account"] != request["account"]):
                result.update({"status": "error", "errorCode": "not-found"})
                self.reply(404, result)
                return
            result["status"] = record["status"] if record is not None else "unknown"
            if record is not None and record["status"] == "settled":
                result.update({key: record[key] for key in ("currency", "amountUnits")})
        self.reply(200, result)

server = HTTPServer(("127.0.0.1", int(sys.argv[2]) if len(sys.argv) > 2 else 0), Provider)
print(server.server_port, flush=True)
server.serve_forever()
