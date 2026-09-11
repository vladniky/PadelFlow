# PadelFlow

## Project overview

PadelFlow is a build-free PWA for running padel tournaments. The application is written in vanilla HTML, CSS, and JavaScript; most UI and domain logic lives in `index.html`.

- `index.html` — application markup, styles, tournament logic, rendering, persistence, and Supabase integration
- `manifest.json` — PWA metadata, icons, and theme colors
- `sw.js` — offline shell caching
- `verify-report.js` / `verify-report.py` — lightweight report-generation checks
- `e2e-test.js` — Playwright regression scenario

There is no `package.json`, build step, bundler, or framework.

## Running and checks

Serve the repository as static files; do not add a build system just to run it.

```bash
python -m http.server 8000
# Open http://localhost:8000/
```

Run the dependency-free report smoke test from the repository root:

```bash
node verify-report.js
```

Useful syntax and data checks:

```bash
node --check sw.js
python -m json.tool manifest.json
```

`e2e-test.js` requires the `playwright` package and currently hardcodes a Linux Chromium path at `e2e-test.js:30`. Do not describe `node e2e-test.js` as portable until that path and dependency setup are fixed.

## Architecture and state

The application is procedural and DOM-driven. Tournament calculations read values from stable element IDs, while a small set of globals tracks rounds, playoff state, and editing context.

Persistence has three layers:

1. Current draft in `localStorage` under `padelFlowCurrentDraft`.
2. Local tournament history under `padelFlowTournamentHistory`.
3. Cloud history and progress in the Supabase `tournaments` table.

The app must continue working locally when Supabase or the network is unavailable. There is no application-level user authentication; cloud isolation depends on the Supabase RLS configuration.

## Change constraints

- Preserve existing DOM `id` values and inline event handlers unless every caller, renderer, restore path, and test is migrated together.
- Preserve the stored draft/history schema or add explicit backward-compatible migration logic. Existing users may already have active tournaments in `localStorage`.
- Keep pair and individual tournament formats, round generation, score restoration, result sorting, playoff flows, history editing, and sharing behavior intact during UI work.
- Treat generated score input IDs such as `a-<round>-<match>` and `b-<round>-<match>` as part of the application contract.
- Do not cache Supabase requests in the service worker.
- Never commit real secrets. The current browser-side Supabase values are public client configuration; privileged keys must not be added to the repository.

## Release requirement

Whenever `index.html` or another cached shell asset changes, increment the `CACHE` value in `sw.js` (for example, `padelflow-v7` to `padelflow-v8`). Without a new cache name, installed PWAs may continue serving stale assets.

After UI changes, verify at minimum:

- desktop and approximately 390 px mobile layouts;
- creation of both pair and individual tournaments;
- score entry, reload restoration, results, and playoff paths for 4 and 6 pairs;
- history loading/editing and offline fallback;
- JavaScript syntax, `manifest.json`, and `git diff --check`.
