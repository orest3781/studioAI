'use strict';
// Build first, verify with Windows trust, and only then let CI upload artifacts.
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {signingConfig} = require('./signing.cjs');
async function main() {
  const config = signingConfig(); // Fail before staging, downloading or building.
  if (process.argv.includes('--check')) {console.log('Signing configuration is present (identity not yet verified).'); return;}
  if (process.platform !== 'win32') throw new Error('Signed release verification must run on Windows.');
  require('./stage.cjs');
  const {build, Platform, Arch} = require('electron-builder');
  await build({targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), config, publish: 'never'});
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
    path.join(__dirname, 'verify-release.ps1'), '-Dist', path.join(__dirname, 'dist'),
    '-Version', require('./package.json').version, '-Publisher', process.env.WINDOWS_PUBLISHER_NAME], {stdio: 'inherit', windowsHide: true});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Signature verification failed; release must not be uploaded.');
  console.log('Signed artifacts verified. Ready for draft upload; nothing was published by this command.');
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
