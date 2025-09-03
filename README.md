# Shilld

## Extension

The extension's source is in `/ext`. See its README for details.

Grab it from the
[Chrome Web Store](https://chromewebstore.google.com/detail/shilld-paid-shill-badges/abbgddgchkmhkclmfaghppfpkanmpppm?authuser=3&hl=en)
or if you want to take the open source route...

...you can install it by downloading the
[zip of a latest release](https://github.com/Swader/shilld/releases/), going
into your Chromium browser's Extensions tab, selecting "Developer Mode", and
then clicking "Load unpacked extension", and pointing it to the folder of this
unpacked zip.

## Website

The website has one static page, one directory, and one dynamic page.

### Landing page

Landing page is static, contains information on how the extension works, how to contribute to it.

### Directory

The directory is a list of shills with their X cards rendered, containing some
metadata. At the top is a search bar for fuzzy searching (client-side only)
among these entries based on those values. Clicking on any of them, or visiting
shilld.xyz/username opens the dynamic page for that account.

### Account page

Each account page (e.g. shilld.xyz/shills/example) renders the information from
`web/dist/shills/example/example.json`, which is sourced from the per-user file at
`web/shills/example.json`. Per-user files contain the basic info like name,
description, address, and more, plus `proofs` with
`{ name, date, description, urls[] }` which explain why this person is on the
list.

During build, all per-user files in `web/shills/` are aggregated into
`web/dist/shills/_all.json` (only basic info is kept, details discarded) to
power the directory and extension list, and copied individually into
`web/dist/shills/<username>/<username>.json` for account pages and corresponding
`index.html` so the content is indexable and sitemappable.

The extension fetches from `https://shilld.xyz/shills/_all.json` and falls back
to its bundled `ext/shills/_all.json` (usernames only, synchronized at build time)
if the remote is unavailable.

### Design

Design matches the screenshots of the badge from `web/screens`.

## Contributing new entries

To add or edit a shill entry:

1. Create or edit a JSON file in `web/shills/<username>.json` with this shape:

    ```json
    {
    "id":"12345678",
    "username": "exampleuser",
    "name": "Example User",
    "image": "https://unavatar.io/twitter/exampleuser",
    "bio": "Short bio.",
    "proofs": [
        { "name": "Source/claim", "date": "2025-01-01", "description": "Context.", "urls": ["https://..."] }
    ]
    }
    ```

    These are required fields. Optionally, add extra fields - see other files for inspiration.

2. Run the build:

    ```bash
    bun run build
    ```

    This will:

    - Aggregate all `web/shills/*.json` (except `_all.json`) into
    `web/dist/shills/_all.json`.
    - Copy per-account files into `web/dist/shills/<username>/[<username>.json|index.html]`.
    - Generate the fallback file `shills.json` to put into the extension and zip
      the extension for Chrome Web Store deployment.

3. Open `web/dist` in a static server to validate pages and JSON, e.g. use the
   `npx http-server` command.

    Deployment should serve `web/dist` at the site root so the extension can reach `https://shilld.xyz/shills/_all.json`.

## TODO

- CI to build and attach `dist/ext/shilld.zip` on release [todo]
- Add 404 fallback config on hosting provider [todo]

## CI & Deployment

- GitHub Actions builds the site on every push to `main` and deploys `web/dist` to GitHub Pages.
- Workflow: `.github/workflows/deploy.yml`.
- GitHub Pages in repo settings should be set to “Deploy from GitHub Actions”.

## Scripts

Use Bun to run builds:

```bash
bun run build        # build site + zip extension
bun run build:site   # build site only (web/dist)
bun run build:ext    # package extension only (dist/ext/shilld.zip)
```

## Support

If you find this useful, consider supporting ongoing maintenance and hosting:

- ETH / stablecoins: `0x655Bd7B8c998AB85AD50754106BfEdc79ACd20AC`
- SOL / SOL stables: `ZqLfXJw5iLQjtPUZLByf3wWBkLuMaip3HSbSSVakMKH`

Thank you!

## Fetching X user data

Optional utility script.

Use the Bun script to fetch public user data from X for batches of usernames:

```bash
bun run fetch-x-users.ts --csv usernames.csv
```

Add your bearer token to `.env` - copy `.env.example` to `.env` and change it.

- CSV can contain a header (`username`/`handle`/`user`) or just the usernames in
  the first column. Leading `@` is ok.
- Upper limit: 100 usernames per call (X API constraint). The script enforces
  this and exits if exceeded.
- Output: writes one JSON per user to `fetched/<username>.json`. The final
  console output includes a `missing` array for any usernames the API did not
  return (with optional status/detail for debugging typos/suspensions).
- Rate limits: on HTTP 429 the script exits gracefully and prints the reset
  time. It avoids making a second call in that window.

If you don't have an API token or want to check a single user interactively, you
can use [this one-by-one tool](https://get-id-x.foundtt.com/en/).
