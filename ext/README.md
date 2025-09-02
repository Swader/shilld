# Shilld Chrome Extension

Adds a very obvious "PAID SHILL" badge to tweets and profile headers for
usernames you specify, and links the badge to `https://shilld.xyz/<username>`.

## How it works (CORS-safe)

- The extension fetches the canonical list from
  `https://shilld.xyz/shills/_all.json` via a background service worker with
  host permissions. This bypasses page CORS limitations safely within Chrome's
  extension security model.
- The result is cached in `chrome.storage.local` for 5 days. If the network is
  down or the URL is unreachable, it serves the last cached list; if there is no
  cache yet, it falls back to the bundled `shills.json` (a usernames list synced
  at build time).

## Install

Either find it in the Chrome Web Store via [shilld.xyz](https://shilld.xyz) or:

1. Load the extension in Chrome:
   - Go to `chrome://extensions`.
   - Enable "Developer mode" (top-right).
   - Click "Load unpacked" and select this folder.

2. Visit X/Twitter (`x.com` or `twitter.com`). Tweets and profile headers for
   usernames in the remote list will show a bold red/orange "PAID SHILL" badge
   that links to `https://shilld.xyz/shill/<username>`.

## Managing the list

- Do not edit `_all.json` or `shills.json` directly unless you really know what
  you're doing and want to do it. Instead, contribute by adding or editing
  `web/shills/<username>.json` in the repo.
- For details instructions see the root project [README](../README.md).

## Cache behavior

- Cache duration: 5 days.
- On success, new data overwrites the cache immediately.
- On failure, the extension uses the last cached data. If no cache exists, it falls back to the bundled `shills.json`.
- To force-refresh immediately, click the Reload icon for the extension in `chrome://extensions` and refresh Twitter tabs.

## Notes

- Works on both `x.com` and `twitter.com` (including www and mobile subdomains).
- The content script observes dynamic page updates (infinite scroll, navigation within the SPA) and inserts badges as new tweets/profiles appear.
- No data leaves your browser; this runs entirely as a local content script.

## Fetching user data for research

For bulk lookups with your own X API token, this repo includes a Bun script:

```bash
bun run fetch-x-users.ts --csv usernames.csv
```

Usage details in [root README](../README.md).
