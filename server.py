"""Offscript's local web server and private Pangram API client (Python 3.9+)."""
import hashlib
import json
import math
import os
import re
import sqlite3
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA = ROOT / ".local"
BASE = "https://text.external-api.pangram.com"
PORT = int(os.getenv("PORT", "8787"))
MAX_CHARS = 24000
LOCKS = [threading.Lock() for _ in range(16)]
STATUS_LOCK = threading.Lock()
status_cache = {}
STATIC_TYPES = {".html":"text/html", ".css":"text/css", ".js":"text/javascript",
                ".mp3":"audio/mpeg", ".woff2":"font/woff2", ".png":"image/png", ".json":"application/json; charset=utf-8"}

class Problem(Exception):
    def __init__(self, status, message):
        self.status = status
        self.message = message

def api_key():
    value = os.getenv("PANGRAM_API_KEY", "").strip()
    if value:
        return value
    try:
        for line in (ROOT / ".env").read_text().splitlines():
            match = re.match(r"^\s*(?:export\s+)?PANGRAM_API_KEY\s*=\s*(.*?)\s*$", line)
            if match:
                return match[1].strip().strip("\"'")
    except FileNotFoundError:
        pass
    return ""

def provider(key, path, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = Request(BASE + path, data=body, headers={
        "x-api-key":key, "Content-Type":"application/json", "Accept":"application/json",
        "User-Agent":"Offscript/1.0"})
    try:
        with urlopen(req, timeout=12) as res:
            obj = json.load(res)
            if isinstance(obj, dict):
                return obj
    except HTTPError as exc:
        messages = {
            400:"Pangram could not process this text.", 401:"Pangram rejected the API key. Check .env.",
            402:"The Pangram account needs API credits.", 403:"This key does not have access to the requested Pangram service.",
            422:"Pangram could not analyze this input. Try a longer passage of prose.",
            429:"Pangram is rate-limiting requests. Try again shortly."}
        raise Problem(exc.code if exc.code in messages else 502, messages.get(exc.code, "Pangram is temporarily unavailable. Try again.")) from None
    except (TimeoutError, OSError, URLError, ValueError):
        raise Problem(503, "Could not reach Pangram. Check the connection and retry.") from None
    raise Problem(502, "Pangram returned an unreadable response.")

def connection(key):
    if not key:
        return {"state":"missing", "message":"Add PANGRAM_API_KEY to the project’s .env file and save."}
    identity = hashlib.sha256(key.encode()).hexdigest()
    with STATUS_LOCK:
        if status_cache.get("key") == identity and status_cache["expires"] > time.monotonic():
            return status_cache["result"]
        try:
            balance = provider(key, "/balance").get("available_balance_usd")
            if balance is not None and float(balance) <= 0:
                result = {"state":"credits", "message":"Pangram accepted your key. Add the hackathon API credits to this account to run scans."}
            else:
                result = {"state":"connected", "message":"Pangram accepted your key and the account has API credits."}
        except Problem as exc:
            result = {"state":"error", "message":exc.message}
        status_cache.update(key=identity, expires=time.monotonic() + (60 if result["state"] == "connected" else 8), result=result)
        return result

def classify(raw):
    verdict = str(raw.get("prediction_short", "")).strip().lower()
    windows = raw.get("windows") or []
    labels = {"ai":"ai", "human":"human", "mixed":"mixed", "ai-assisted":"mixed"}
    kind = labels.get(verdict, "uncertain")
    if not windows or any(str(w.get("confidence", "")).lower() != "high" for w in windows):
        kind = "uncertain"
    shares = {}
    for field in ("ai", "ai_assisted", "human"):
        value = raw.get("fraction_" + field)
        if isinstance(value, (int, float)) and math.isfinite(value) and 0 <= value <= 1:
            shares[field] = round(value * 100)
    return {"kind":kind, "shares":shares, "version":str(raw.get("version", "")),
            "headline":str(raw.get("headline", "")), "prediction":str(raw.get("prediction", ""))}

def scan(text, key):
    if not isinstance(text, str) or len(text) > MAX_CHARS:
        raise Problem(400, "Use up to 24,000 characters.")
    text = text.strip()
    if len(text.split()) < 50:
        raise Problem(422, "Pangram needs at least 50 words of prose.")
    if not key:
        raise Problem(503, "Add PANGRAM_API_KEY to .env and save, then scan again.")
    digest = hashlib.sha256(("default\x00" + text).encode()).hexdigest()
    # Keep pending task IDs across timeouts so a retry polls the already-paid scan.
    with LOCKS[int(digest[:2], 16) % len(LOCKS)], sqlite3.connect(DATA / "scans.db") as db:
        row = db.execute("SELECT task, result FROM scans WHERE digest=?", (digest,)).fetchone()
        if row and row[1]:
            return json.loads(row[1])
        task = row[0] if row else None
        if not task:
            obj = provider(key, "/task", {"text":text, "model":"default", "public_dashboard_link":False})
            task = obj.get("task_id")
            if not isinstance(task, str) or not task:
                raise Problem(502, "Pangram did not return a task ID.")
            db.execute("INSERT OR REPLACE INTO scans VALUES (?, ?, NULL)", (digest, task))
            db.commit()
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            raw = provider(key, "/task/" + quote(task, safe=""))
            stage = raw.get("stage")
            if stage == "STAGE_SUCCESS":
                result = classify(raw)
                db.execute("UPDATE scans SET result=? WHERE digest=?", (json.dumps(result), digest))
                return result
            if stage == "STAGE_FAILED":
                db.execute("DELETE FROM scans WHERE digest=?", (digest,))
                db.commit()
                raise Problem(422, "Pangram could not classify this passage. Try another text.")
            time.sleep(1)
        raise Problem(504, "Pangram is still analyzing. Retry to resume the same scan.")

def original_text(post_id):
    # Only curator-selected, public LinkedIn pages can be retrieved.
    cards = json.loads((PUBLIC / "linkedin.json").read_text())
    post = next((p for p in cards if p["id"] == post_id), None)
    if post is None:
        raise Problem(404, "This original is not in the feed.")
    if post["featured"]:
        return post["body"]
    digest = post["sourceHash"]
    cached = DATA / ("original-" + digest)
    if cached.is_file():
        saved = cached.read_text()
        if hashlib.sha256(saved.encode()).hexdigest() == digest:
            return saved
    try:
        with urlopen(post["url"], timeout=8) as response:
            page = response.read(3000000).decode()
        schemas = re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', page, re.S)
        for schema in schemas:
            obj = json.loads(schema)
            if isinstance(obj, dict) and obj.get("@type") == "SocialMediaPosting":
                text = obj.get("articleBody", "").strip()
                if hashlib.sha256(text.encode()).hexdigest() == digest:
                    cached.write_text(text)
                    return text
    except (OSError, ValueError):
        pass
    raise Problem(409, "LinkedIn has changed this post or the original is unavailable. Open it on LinkedIn to check the current version.")


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body, content_type="application/json"):
        if content_type == "application/json":
            body = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; img-src 'self' data: blob: https://media.licdn.com; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def local_request(self):
        origin = self.headers.get("Origin")
        hosts = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
        return self.headers.get("Host") in hosts and (not origin or origin in {"http://" + h for h in hosts})

    def do_GET(self):
        if not self.local_request():
            return self.reply(403, {"error":"Use the local app address."})
        path = urlsplit(self.path).path
        if path == "/api/status":
            return self.reply(200, connection(api_key()))
        asset = PUBLIC / ("index.html" if path == "/" else path.lstrip("/"))
        if asset.parent != PUBLIC or not asset.is_file() or asset.suffix not in STATIC_TYPES:
            return self.reply(404, {"error":"Not found."})
        self.reply(200, asset.read_bytes(), STATIC_TYPES[asset.suffix])

    def do_POST(self):
        if not self.local_request():
            return self.reply(403, {"error":"Use the local app address."})
        if self.path != "/api/analyze":
            return self.reply(404, {"error":"Not found."})
        try:
            if self.headers.get_content_type() != "application/json":
                raise Problem(415, "Send JSON.")
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 160000:
                raise Problem(413, "Post is too large or empty.")
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise ValueError
            text = original_text(payload["post_id"]) if "post_id" in payload else payload.get("text")
            self.reply(200, scan(text, api_key()))
        except Problem as exc:
            self.reply(exc.status, {"error":exc.message})
        except (ValueError, UnicodeError):
            self.reply(400, {"error":"Invalid JSON."})
        except sqlite3.Error:
            self.reply(500, {"error":"Could not save the local scan. Check available disk space."})

if __name__ == "__main__":
    DATA.mkdir(mode=0o700, exist_ok=True)
    with sqlite3.connect(DATA / "scans.db") as db:
        db.execute("CREATE TABLE IF NOT EXISTS scans (digest TEXT PRIMARY KEY, task TEXT, result TEXT)")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Offscript is ready at http://127.0.0.1:{PORT}", flush=True)
    server.serve_forever()
