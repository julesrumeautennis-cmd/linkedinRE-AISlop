"""Read up to ten posts via the local, signed-in LinkedIn MCP (Python 3.12)."""
import asyncio
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, build_opener

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parent
PROFILE = ROOT / ".local/linkedin-mcp/profile"


def linkedin_url(value):
    url = urljoin("https://www.linkedin.com", str(value))
    parts = urlsplit(url)
    if (parts.scheme == "https" and parts.netloc in {"linkedin.com", "www.linkedin.com"}
            and parts.path.startswith(("/posts/", "/feed/update/"))):
        return "https://www.linkedin.com" + parts.path
    return None


class PublicPostRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not linkedin_url(newurl):
            raise ValueError("Post unavailable publicly")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def cdn_image(item):
    url = item.get("url") if isinstance(item, dict) else item
    if isinstance(url, str) and urlsplit(url).netloc == "media.licdn.com" and urlsplit(url).scheme == "https":
        return url


def post_card(ref):
    url = linkedin_url(ref.get("url"))
    if ref.get("kind") != "feed_post" or not url:
        return None
    activity = re.search(r'(?:activity[:-]|ugcPost:|share:)(\d+)', url)
    uid = activity[1] if activity else hashlib.sha256(url.encode()).hexdigest()[:20]
    body = (ref.get("text") or "").strip()
    post = {"id":"mcp-" + uid, "linkedin":True, "mcp":True, "url":url,
            "name":"LinkedIn post", "meta":"From your LinkedIn feed", "mark":"in", "theme":"own",
            "body":body, "wordCount":0, "excerptOnly":True, "photos":[]}
    try:
        with build_opener(PublicPostRedirect()).open(url, timeout=5) as page:
            html = page.read(3000000).decode()
        schemas = re.findall(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html, re.S)
        for schema in schemas:
            obj = json.loads(schema)
            if not isinstance(obj, dict) or obj.get("@type") != "SocialMediaPosting":
                continue
            caption = (obj.get("articleBody") or "").strip()
            if not caption:
                continue
            author = obj.get("author") or {}
            images = obj.get("image") or []
            if not isinstance(images, list):
                images = [images]
            post.update(body=caption, wordCount=len(caption.split()), excerptOnly=False,
                        name=author.get("name") or post["name"], avatar=cdn_image(author.get("image")),
                        photos=[u for image in images if (u := cdn_image(image))][:10])
            break
    except (OSError, ValueError, AttributeError):
        pass
    return post


def data(result):
    if result.is_error:
        raise ValueError("The LinkedIn session needs attention. Open the local sign-in and retry.")
    if result.structured_content:
        return result.structured_content
    return json.loads(result.content[0].text)


async def read():
    executable = Path(sys.executable).parent / "mcp-server-linkedin"
    args = ["--transport", "stdio", "--no-auto-import", "--user-data-dir", str(PROFILE)]
    client = StdioServerParameters(command=str(executable), args=args, cwd=str(PROFILE.parent))
    with open(os.devnull, "w") as logs:
        async with stdio_client(client, errlog=logs) as streams, ClientSession(*streams) as session:
            await session.initialize()
            status = data(await session.call_tool("get_session_status", {}))
            if not status.get("session", {}).get("stored"):
                return {"error":"Sign in to LinkedIn in the local MCP window, then sync again. To open it again, run the sign-in command in the README."}
            response = data(await session.call_tool("get_feed", {"num_posts":10, "max_scrolls":2}))
    refs = response.get("references", {}).get("feed", [])
    if not refs:
        return {"error":"LinkedIn MCP returned no post links. Check your sign-in and try again."}
    cards = await asyncio.gather(*(asyncio.to_thread(post_card, ref) for ref in refs[:10]))
    unique = {}
    for card in cards:
        if card:
            unique.setdefault(card["id"], card)
    if not unique:
        return {"error":"LinkedIn MCP returned no readable post links."}
    return {"posts":list(unique.values())}


if __name__ == "__main__":
    try:
        print(json.dumps(asyncio.run(read())))
    except Exception:
        print(json.dumps({"error":"Could not read the home feed from LinkedIn MCP. Check the local sign-in and retry."}))
