# Offscript

A LinkedIn feed you can switch between its original appearance and Pangram verdict stickers. The public demo opens with twenty real LinkedIn posts, including Jules Rumeau’s NASA Space Apps post. All twenty captions meet the 50-word minimum. Each page load starts at 0/20, including on browsers that have saved personal posts.

## Demo

Click **Scan the feed** for a live batch, or **Scan with Pangram** on an individual post. Results appear as each request finishes. **Restart demo** clears the verdicts and starts a fresh run. Personal imports are available under **Saved posts**. Open a sticker for the model’s underlying verdict. Offscript labels a scored post **AI SLOP** when Pangram's unrounded `fraction_ai` exceeds 0.30, and **HUMAN** at or below 0.30. This is a product rule. The percentage estimates the share of AI-generated text. **Hide AI** folds flagged cards. **Verdict stickers** toggles the overlay. To run a fresh scan, choose **Add your LinkedIn post**, paste at least 50 words, then choose **Scan with Pangram**.

## Run locally

Requires Python 3.9+. Copy `.env.example` to `.env` and set `PANGRAM_API_KEY`, or export it in the server's environment. Run `python3 server.py` and open <http://127.0.0.1:8787>. Results and resumable Pangram task IDs are cached in the local SQLite database. Browser-added posts and attachments stay in this browser. A scan sends the caption to Pangram.

## Sync a personal LinkedIn feed

With [uv](https://docs.astral.sh/uv/) and Chrome installed, run these commands in the project directory on your Mac.

```sh
uv venv --python 3.12 .local/linkedin-env
uv pip install --python .local/linkedin-env/bin/python mcp-server-linkedin==4.31.0
.local/linkedin-env/bin/mcp-server-linkedin --login --no-auto-import --user-data-dir "$PWD/.local/linkedin-mcp/profile"
```

Complete LinkedIn sign-in in the dedicated browser window. Start the local Offscript server and choose **Sync my LinkedIn**. On the hosted site, choose **Open local connector** and confirm the destination shown in the popup. Your local bridge calls the community [LinkedIn MCP server](https://github.com/stickerdaniel/linkedin-mcp-server) over stdio, checks session state, and calls `get_feed` for up to ten recent posts. It resolves available public captions and photos from LinkedIn. Excerpt-only cards link to their source and remain unscored. Subsequent syncs refresh matching cards. Your LinkedIn session stays on your machine. Imported cards stay in the browser that requested them.

## Vercel

Import the GitHub repository, choose the Other framework preset and set `PANGRAM_API_KEY` as a server-only Production secret. The repository includes static assets and three Python functions. The catalog ships with public excerpts and source hashes. Production packages the matching full captions in the server-only file `data/captions.json`, keyed by SHA-256. When that optional bundle is absent, the server checks the original public post against its hash. A new demo run submits fresh Pangram tasks. Retries within a run reuse completed or pending tasks where the instance cache is available. Curated runs and custom text have separate rate limits. Local LinkedIn sessions are excluded from the deployment. The status endpoint checks API connectivity without displaying the account balance publicly.

To attach a domain, open the project's Settings → Domains, add the hostname and copy the DNS records displayed by Vercel to your DNS provider.
