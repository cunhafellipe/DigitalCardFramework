"""Read-only synthetic code status fixture; Python standard library only.

Run with a JSON records file and optional loopback port (default 0).
CODE_PROVIDER_TOKEN supplies the credential; CODE_PROVIDER_ID defaults to example.game.
Records are an array of {code, externalId, status, eventId, occurredAt}.
Only preconfigured exact matches return a status. This is not a live redemption service.
"""
import hmac
import json
import os
import re
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

PROTOCOL = "digital-card-code-status@1"
PROVIDER = os.environ.get("CODE_PROVIDER_ID", "example.game")
TOKEN = os.environ["CODE_PROVIDER_TOKEN"]
ID = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}\Z")
REQUEST = re.compile(r"[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\Z")
if not ID.fullmatch(PROVIDER) or PROVIDER in {"__proto__", "constructor", "prototype"}:
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

def text(value, maximum, controls=False):
    if not isinstance(value, str) or not value.strip() or len(value.encode("utf-16-le")) // 2 > maximum:
        return False
    return not controls or not re.search(r"[\x00-\x1f\x7f]", value)

with open(sys.argv[1], "rb") as records_file:
    raw_records = records_file.read(65537)
if len(raw_records) > 65536:
    raise ValueError("Fixture records exceed limit")
records = parse(raw_records)
if not isinstance(records, list) or len(records) > 100:
    raise ValueError("Invalid fixture records")
statuses = {}
for record in records:
    if (not isinstance(record, dict) or set(record) != {"code", "externalId", "status", "eventId", "occurredAt"}
        or not text(record["code"], 512, True) or record["status"] not in {"redeemed", "revoked"}
        or (record["externalId"] is not None and not text(record["externalId"], 300))
        or not text(record["eventId"], 300, True)
        or not isinstance(record["occurredAt"], str)
        or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z", record["occurredAt"])):
        raise ValueError("Invalid fixture record")
    datetime.fromisoformat(record["occurredAt"])
    identity = (record["code"], record["externalId"])
    if identity in statuses:
        raise ValueError("Duplicate fixture record")
    statuses[identity] = {key: record[key] for key in ("status", "eventId", "occurredAt")}

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
        if not hmac.compare_digest(self.headers.get("Authorization", "").encode("utf-8"), ("Bearer " + TOKEN).encode("utf-8")):
            self.reply(401, {})
            return
        try:
            length = self.headers.get("Content-Length", "")
            if (self.path != "/code-status" or self.headers.get("Transfer-Encoding")
                or self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json"
                or not re.fullmatch(r"[0-9]+", length) or not 0 < int(length) <= 8192):
                raise ValueError()
            request = parse(self.rfile.read(int(length)))
            if not isinstance(request, dict) or set(request) != {"protocol", "operation", "requestId", "providerId", "codeId", "externalId", "code"}:
                raise ValueError()
            if (request["protocol"] != PROTOCOL or request["operation"] != "lookup"
                or not isinstance(request["requestId"], str) or not REQUEST.fullmatch(request["requestId"])
                or request["providerId"] != PROVIDER or not isinstance(request["codeId"], str)
                or not ID.fullmatch(request["codeId"]) or request["codeId"] in {"__proto__", "constructor", "prototype"}
                or not text(request["code"], 512, True)
                or (request["externalId"] is not None and not text(request["externalId"], 300))):
                raise ValueError()
        except (ValueError, TypeError, UnicodeError, TimeoutError):
            self.reply(400, {})
            return
        result = {key: request[key] for key in ("protocol", "requestId", "providerId", "codeId")}
        result.update(statuses.get((request["code"], request["externalId"]), {"status": "unknown"}))
        self.reply(200, result)

server = HTTPServer(("127.0.0.1", int(sys.argv[2]) if len(sys.argv) > 2 else 0), Provider)
print(server.server_port, flush=True)
server.serve_forever()
