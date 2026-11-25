# Offscript

A local LinkedIn-style feed featuring ten real public posts and their original photos. The first card is Jules Rumeau’s NASA Space Apps post. Each card links back to LinkedIn. Source counts are snapshots from November 24, 2026. The feed is curated and has no automatic LinkedIn timeline subscription.

## Start

Requires Python 3.9 or later. On first setup, copy `.env.example` to `.env` and set `PANGRAM_API_KEY`. An exported environment variable also works.

```sh
python3 server.py
```

Open <http://127.0.0.1:8787/>. Keep using the same browser and address for saved personal posts, photos and audio.

## Give the demo

Open **Scan details** on a card to see the actual Pangram verdict and its source. Eight full public captions were checked on the authenticated Pangram dashboard on November 24. Two captions were under the app's 50-word minimum. **Hide AI detections** folds flagged writing, including a mixed post when Pangram reports “AI Detected”. Low-confidence posts stay visible. **Review results** lists the feed.

Choose **Add your LinkedIn post** to paste a new caption and optionally attach a photo, a voice note or actual impressions. **Scan with Pangram** submits the text to the official async API, which requires an available API balance. The status control checks the balance. A zero-balance response on a personal post offers a copy button and a link to the official dashboard.

## Data

The public catalog contains source URLs, original LinkedIn-hosted media URLs, counts, short previews and the verified web results. Scans use the full caption. The backend resolves only curated URLs and checks the caption hash against the snapshot. Scan summaries and cached source text live locally in the ignored `.local/` directory. The browser loads photos from LinkedIn’s CDN. Newly added posts, uploaded photos, and voice notes remain in this browser’s IndexedDB.
