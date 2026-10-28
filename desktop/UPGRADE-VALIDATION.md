# Manual upgrade validation — 2026-10-28

Result: installer upgrade and rollback passed; launching unsigned 0.1.1 was blocked by Windows Application Control. End-to-end upgrade validation is incomplete. No policy changes, exceptions, certificate imports, unblocking, or security bypasses were attempted.

- Published unsigned 0.1.0 and 0.1.1 installers with SHA-256 checksum files to GitHub Releases.
- Downloaded both published installers and verified their checksums.
- Installed 0.1.0 per-user and confirmed its authenticated backend version and external runtime path.
- Verified the native Manual updates dialog and opened the GitHub release page from the app.
- Both installer versions refused to proceed while StudioAI was running (exit code 2); neither forced the app closed.
- Closed 0.1.0 normally, upgraded in place to 0.1.1, and verified the installed executable version 0.1.1.0.
- Windows Application Control blocked launching that executable. Stopped the launch test without changing security.
- Restored 0.1.0 using its published installer. Confirmed backend version 0.1.0, idle queues, and an existing saved caption document at revision 4.
- Repeated preservation comparison after upgrade and after rollback: all 862 workspace file hashes, SQLite logical contents and table counts, runtime configuration, 97 model file records, and eight active policy hashes matched.
- Model comparison checks size, modification time and file identity; model weight contents were not fully rehashed.
- All 128 generation package records were unchanged. Defender's existing reported configuration was unchanged; Windows also reports Bitdefender installed. No antivirus settings were modified.
- Eight desktop/signing unit tests passed. Production generation/export code was unchanged by this manual-update change.

GitHub latest points to v0.1.0. v0.1.1 is a prerelease with the block documented. Future unsigned versions can also be blocked; manual distribution does not guarantee acceptance by Windows security policy.

Local preservation evidence and an online SQLite backup are retained in desktop/upgrade-validation on the development PC, excluded from the source bundle and releases. No models, workspace data, runtime credentials or personal media were uploaded.
