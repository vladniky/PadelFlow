# PadelFlow

## Project overview

PadelFlow is a build-free PWA for running padel tournaments. The application is written in vanilla HTML, CSS, and JavaScript; most UI and domain logic lives in `index.html`.

- `index.html` — application markup, styles, tournament logic, rendering, and local persistence
- `manifest.json` — PWA metadata, icons (`icon-192.png`, `icon-512.png`, `icon-512-maskable.png`), and theme colors; `apple-touch-icon.png` (180×180) is linked from `index.html`
- `sw.js` — offline shell caching; navigations fall back to the cached page after `NAV_TIMEOUT_MS` (3 s) so the app opens on a weak court-side connection
- `verify-report.js` / `verify-report.py` — lightweight report-generation checks
- `e2e-test.js` — Playwright regression scenario

There is no `package.json`, build step, bundler, or framework.

## Running and checks

Serve the repository as static files; do not add a build system just to run it.

```bash
npx --yes http-server -p 8000 -c-1
# Open http://localhost:8000/
```

Python is not installed on the main dev machine (`python` opens the Microsoft Store), so prefer Node-based commands.

Run the dependency-free report smoke test from the repository root:

```bash
node verify-report.js
```

Useful syntax and data checks:

```bash
node --check sw.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
```

`e2e-test.js` requires the `playwright` package (not installed in the repo). It uses Playwright's bundled browser, or a custom one via the `PW_CHROMIUM_PATH` environment variable.

`verify-report.js` strips the boot calls (`registerServiceWorker(); initApp();`) at the end of the script and runs only report generation in a minimal fake DOM. Keep those two calls last in the script; code that runs at script load must tolerate `window` being a stub with only `addEventListener`.

## Architecture and state

The application is procedural and DOM-driven. Tournament calculations read values from stable element IDs, while a small set of globals tracks rounds, playoff state, and editing context.

Everything is stored locally in `localStorage` (the Supabase cloud layer was removed on 2026-09-11):

1. Current draft under `padelFlowCurrentDraft`.
2. Tournament history under `padelFlowTournamentHistory`.
3. Small UI flags: `padelFlowLastBackupAt`, `padelFlowInstallHintClosed`.

Write draft/history only through `safeSetItem()`: it never throws, shows a one-time warning, and returns `false` so callers can keep state intact (e.g. `saveTournament()` must not drop the draft when the write fails).

History backup is a user-controlled `.json` file (`exportHistory()` / `applyHistoryImport()`). Import only adds tournaments with new ids and never overwrites. Imported files are untrusted: ids must match `SAFE_HISTORY_ID` because they are interpolated into `onclick` attributes, and every imported field rendered into HTML must go through `escapeHtml()`.

While a tournament runs, a Screen Wake Lock keeps the display on (`updateWakeLock()`, driven by `setTournamentStarted()` and `visibilitychange`). `navigator.storage.persist()` is requested when a tournament starts.

## Change constraints

- Preserve existing DOM `id` values and inline event handlers unless every caller, renderer, restore path, and test is migrated together.
- Preserve the stored draft/history schema or add explicit backward-compatible migration logic. Existing users may already have active tournaments in `localStorage`.
- Keep pair and individual tournament formats, round generation, score restoration, result sorting, playoff flows, history editing, and sharing behavior intact during UI work.
- Treat generated score input IDs such as `a-<round>-<match>` and `b-<round>-<match>` as part of the application contract.
- The app has no network dependencies at runtime; do not add CDN scripts or remote fonts — the app must start fully offline at the court.
- Never commit real secrets.

## Release requirement

Whenever `index.html` or another cached shell asset changes, increment the `CACHE` value in `sw.js` (for example, `padelflow-v15` to `padelflow-v16`). Without a new cache name, installed PWAs may continue serving stale assets.

After UI changes, verify at minimum:

- desktop and approximately 390 px mobile layouts;
- creation of both pair and individual tournaments;
- score entry, reload restoration, results, and playoff paths for 4 and 6 pairs;
- history loading/editing, backup export/import, and offline fallback;
- JavaScript syntax, `manifest.json`, and `git diff --check`.
