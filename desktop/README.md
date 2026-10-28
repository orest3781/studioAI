# StudioAI Windows: manual updates

Current validation: 0.1.0 runs on the test PC. The 0.1.1 installer upgraded successfully, but Windows Application Control blocked launching it; it is a prerelease and 0.1.0 was restored. See [UPGRADE-VALIDATION.md](UPGRADE-VALIDATION.md). End-to-end upgrade validation remains incomplete; no security exceptions were added.

This installer is unsigned and reuses an existing AI Video setup. It does not install or replace Python, ComfyUI, CUDA, models, FFmpeg, or caption dependencies. Fresh-PC setup is not supported yet.

## Install and update

1. Download the Windows x64 installer from https://github.com/orest3781/studioAI/releases/latest.
2. Save edits and finish or cancel queued jobs. Quit StudioAI. The installer refuses to run while StudioAI is open.
3. Run the installer over the existing installation. Do not uninstall first. StudioAI installs per-user; its code is separate from your selected AI Video runtime folder.
4. Reopen StudioAI. On first launch, select the existing folder containing `.venv`, `ComfyUI`, and `studio/data`. Later launches remember it. Start ComfyUI using your existing launcher when needed.

The StudioAI > Manual updates menu shows your installed version and opens the fixed GitHub Releases page in your browser. There are no automatic checks, downloads, installs, updater dependencies or update feeds. The installer never copies or deletes your external models, originals, captions, styles or SQLite workspace. Save your work before upgrading. Keep normal backups.

Windows may identify the unsigned installer as an unknown publisher. Keep SmartScreen, Defender, Application Control and certificate validation enabled. If Windows blocks execution, stop; do not disable security or change trust settings. A SHA256SUMS.txt release asset lets you compare the downloaded file's SHA-256 checksum; it does not establish a trusted publisher.

## Build and publish

From `desktop`: `npm ci`, `npm test`, `npm run dist`. Artifacts are in `dist`. `npm run release` builds locally without uploading. `payload.cjs` is an explicit code/recipe allowlist; it excludes all models, environments, logs and user data.

Use `node desktop/source-bundle.cjs` from the local AI Video root to prepare the clean source repository in `desktop/source-release`. Never upload the whole AI Video folder.

For a new release, run `npm version 0.1.2 --no-git-tag-version`, update RELEASE-NOTES.md, commit, and push a matching `v0.1.2` tag. GitHub Actions tests and builds an unsigned installer and SHA-256 checksum into a draft release. Review then publish the draft. Existing release assets are not overwritten. No signing credentials are needed for this manual-release workflow.

For development, set STUDIO_WORKSPACE_ROOT to your runtime folder, run `npm run setup:electron` once, then `npm start`. Runtime configuration lives in `%APPDATA%/StudioAI/runtime.json`; backend logs are under `%APPDATA%/StudioAI/logs`.

The optional `release:signed`, signing.cjs and verify-release.ps1 files are retained for a future trusted signing identity. They are not used by the manual release workflow and still refuse unsigned input. Windows security settings are never changed by these scripts.
