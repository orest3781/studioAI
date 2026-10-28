'use strict';
const RELEASES_URL = 'https://github.com/orest3781/studioAI/releases/latest';
function configure({version, showMessage, openExternal}) {
  return {async open() {
    const result = await showMessage({type: 'info', title: 'StudioAI manual updates',
      message: `Installed version: ${version}`,
      detail: 'Open GitHub Releases and download the newer Windows installer. Save your edits, finish or cancel queued work, then quit StudioAI before running it. Install over the existing app; do not uninstall first. Models and workspace stay in your existing runtime folder.\n\nThese releases are unsigned. Keep Windows security enabled; if Windows blocks an installer, stop rather than changing security settings. StudioAI never downloads or installs updates automatically.',
      buttons: ['Cancel', 'Open GitHub Releases'], defaultId: 0, cancelId: 0});
    if (result.response === 1) await openExternal(RELEASES_URL);
  }};
}
module.exports = {configure, RELEASES_URL};
