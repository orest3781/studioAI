# StudioAI for Windows

This first installer reuses an existing AI Video installation. It does not install or update Python, ComfyUI, models, CUDA, FFmpeg or caption dependencies. Fresh-PC installation is not supported yet.

## Use

Install the NSIS `.exe`, open StudioAI, and select the existing folder containing `.venv`, `ComfyUI` and `studio/data`. Save edits and finish queued work before closing the old browser/server version. The desktop app refuses to take over an unrelated process on port 8190. Start ComfyUI using your existing launcher when generation is needed.

StudioAI → Check for updates checks public GitHub releases in `orest3781/studioAI`. Downloads require confirmation. Save edits, then choose Install downloaded update; queued generation, exports and analysis block installation. Closing StudioAI does not install updates. No automatic update checks, telemetry, hosted inference or model uploads are added. Checking/downloading updates contacts GitHub; editing and generation stay local.

App code lives in the install directory. Models, SQLite, originals, caption styles and edits remain in the selected runtime's `studio` folder. Configuration and desktop session credentials live in Electron's per-user `StudioAI`/`studioai-desktop` app-data directory; use the actual `app.getPath('userData')` location for support. Backend logs live under Electron's logs directory. Uninstalling leaves workspace data intact. A crashed desktop process can reconnect to its authenticated backend; unknown servers are never killed.

## Build

From `desktop`: `npm ci`, `npm test`, `npm run dist`. The resulting installer is in `dist`. Local builds are unsigned; Windows may require a trusted signing identity under existing security policy. Do not disable SmartScreen, Application Control, Defender or PowerShell policy. Production releases must be signed.

Set `STUDIO_WORKSPACE_ROOT` to the existing installation for development, run `npm run setup:electron` once to obtain the development Electron binary, then `npm start`. `stage.cjs` copies only `payload.cjs`'s explicit code/recipe list. It never packages local data or model weights. `npm run dist` never publishes.

## GitHub releases

The clean repository needs `studio/`'s allowlisted source files, `desktop/`'s source and lockfile, and `.github/workflows/release.yml`. Do not upload the AI Video folder wholesale. Use `node desktop/source-bundle.cjs` to prepare an allowlisted source tree under `desktop/source-release`.

Configure repository secrets `CSC_LINK` (base64 PFX or supported secure certificate URL) and `CSC_KEY_PASSWORD`, plus repository variable `WINDOWS_PUBLISHER_NAME` matching the certificate's publisher. Never commit the certificate or tokens. The release workflow refuses unsigned publication. Keep the signing identity stable so electron-updater can verify subsequent installers.

Increment `desktop/package.json` and lockfile versions together (`npm version 0.1.1 --no-git-tag-version`), commit, then push tag `v0.1.1`. Actions builds the signed NSIS installer, blockmap and `latest.yml` into a **draft** release. Review its artifacts and release notes, then publish the draft to make it discoverable. Keep all three release assets together. The first signed release should be installed manually before validating a second signed release update.

Use monotonically increasing versions. Downgrades are disabled. The selected runtime and dependencies are deliberately not auto-upgraded; future schema migrations need backups and compatibility tests before release. A production GitHub download/install round trip requires two published signed versions and is not equivalent to the local updater state-machine tests.
