'use strict';
// Explicit downloads and installs. Closing the window never installs an update.
function configure(updater, {confirm, inform, prepare, install}) {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  let checking = false, downloaded = false;
  updater.on('update-not-available', () => inform('StudioAI is up to date.'));
  updater.on('error', error => inform(`Update failed: ${error.message}. Your local workspace is unchanged.`));
  updater.on('update-available', async info => {
    if (await confirm(`StudioAI ${info.version} is available. Download it from GitHub?`)) {
      try {await updater.downloadUpdate();} catch (error) {inform(error.message);}
    }
  });
  updater.on('update-downloaded', () => {downloaded = true; inform('Update downloaded. Save your edits, then choose StudioAI → Install downloaded update.');});
  return {
    async check() {
      if (checking) return;
      checking = true;
      try {await updater.checkForUpdates();} catch {} finally {checking = false;}
    },
    async apply() {
      if (!downloaded) return inform('No downloaded update is ready. Choose Check for updates first.');
      if (!(await confirm('Save your caption edits before continuing. Install the downloaded update and restart StudioAI?'))) return;
      try {await prepare(); install();} catch (error) {inform(error.message);}
    }
  };
}
module.exports = {configure};
