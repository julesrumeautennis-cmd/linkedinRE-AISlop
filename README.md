# Offscript

A local LinkedIn-style feed for the Non-Slop Hackathon. Paste a post, add the real impression count, and attach or record its original voice. Scan the text with Pangram, filter the feed, and play the recording alongside the published version.

## Run locally

Python 3.9 or later is sufficient. In the project directory, copy `.env.example` to `.env` on first setup and enter your key after `PANGRAM_API_KEY=`. The server also accepts that environment variable from your shell. The key is read on each request and remains on the server.

```sh
python3 server.py
```

Open <http://127.0.0.1:8787>. Keep using the same address and browser to retain added posts and recordings. To change the port, set `PORT`.

## Demo

1. Choose **Add your post**. Paste the full published text. Under the optional fields, add the actual impressions and a recording telling the story in your own words.
2. Choose **Scan with Pangram**. The app submits only the text to the [Pangram inference API](https://docs.pangram.com/api-reference/ai-detection), polls the task and displays its result. Use at least 50 words. The status button checks the [API credit balance](https://docs.pangram.com/api-reference/balance).
3. Choose **Hide likely AI**. High-confidence AI posts fold into a single row. Disclosed AI samples can be folded before their first scan. Mixed, uncertain and unscanned personal posts remain visible.
4. Click **Hear the original**. An example pairs a disclosed AI rewrite with 17 seconds of [NASA Apollo 13 mission audio](https://www.nasa.gov/historical-sounds/).

The starter feed is curated locally. The historical texts link to their originals. Names, impressions and voice notes are stored in this browser’s IndexedDB. Completed scan summaries and resumable task IDs are cached under the ignored `.local/` directory. Pangram requires a funded API account for live classification. Sample provenance labels come from the source material. Only successful API responses count as scans.
