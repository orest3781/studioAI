'use strict';
const {app, BrowserWindow, Menu, dialog, session, shell} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const backend = require('./backend.cjs');
let window, instance, exiting = false, closing = false;
const inform = message => dialog.showMessageBox(window, {type: 'info', title: 'StudioAI', message});
const confirm = async message => (await dialog.showMessageBox(window, {type: 'question', title: 'StudioAI', message, buttons: ['Cancel', 'Continue'], defaultId: 0, cancelId: 0})).response === 1;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {if (window) {window.restore(); window.focus();}});
  app.whenReady().then(async () => {
    const configFile = path.join(app.getPath('userData'), 'runtime.json');
    try {
      let config;
      try {config = JSON.parse(fs.readFileSync(configFile, 'utf8'));} catch {}
      let root = process.env.STUDIO_WORKSPACE_ROOT || config?.root;
      if (!root) {
        const selected = await dialog.showOpenDialog({title: 'Select your existing AI Video folder (contains ComfyUI, studio and .venv)', properties: ['openDirectory']});
        if (selected.canceled) {app.quit(); return;}
        root = selected.filePaths[0];
      }
      root = backend.validateRoot(root);
      fs.mkdirSync(app.getPath('userData'), {recursive: true});
      fs.writeFileSync(configFile, JSON.stringify({root}, null, 2));
      const code = app.isPackaged ? path.join(process.resourcesPath, 'studio') : path.join(__dirname, '../studio');
      instance = await backend.start({root, code, version: app.getVersion(), stateFile: path.join(app.getPath('userData'), 'backend-session.json'), logDir: app.getPath('logs')});
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.defaultSession.setPermissionCheckHandler(() => false);
      // Renderer stays local. Manual release links open in the user's browser.
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const allowed = details.url.startsWith(backend.BASE + '/') || /^(blob:http:\/\/127\.0\.0\.1:8190\/|data:)/.test(details.url);
        callback({cancel: !allowed});
      });
      window = new BrowserWindow({width: 1440, height: 960, minWidth: 1024, minHeight: 720, show: false,
        title: 'StudioAI', webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true}});
      window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
      window.webContents.on('will-navigate', (event, url) => {if (!url.startsWith(backend.BASE + '/')) event.preventDefault();});
      const prepare = async () => {await backend.stop(instance.token); instance = null; exiting = true;};
      const update = require('./updates.cjs').configure({version: app.getVersion(),
        showMessage: options => dialog.showMessageBox(window, options),
        openExternal: url => shell.openExternal(url)});
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        {label: 'StudioAI', submenu: [
          {label: 'Manual updates…', click: () => update.open().catch(error => inform(error.message))},
          {label: 'About StudioAI', click: () => inform(`StudioAI ${app.getVersion()}\nLocal runtime: ${root}\nUpdates: github.com/orest3781/studioAI\nModels and workspace data stay in your local runtime folder.`)},
          {type: 'separator'}, {label: 'Quit', accelerator: 'Alt+F4', click: () => window.close()}
        ]}, {role: 'editMenu'}, {role: 'viewMenu'}
      ]));
      window.on('close', event => {
        if (exiting) return;
        event.preventDefault();
        if (closing) return;
        closing = true;
        (async () => {
          if (!(await confirm('Save your edits before closing StudioAI. Close the app now?'))) return;
          try {await prepare(); app.quit();} catch (error) {await inform(`${error.message}\nKeep StudioAI open until work finishes, or cancel the queued work.`);}
        })().finally(() => {closing = false;});
      });
      await window.loadURL(backend.BASE + '/');
      window.show();
    } catch (error) {
      dialog.showErrorBox('StudioAI could not open', error.message);
      app.quit();
    }
  });
  app.on('before-quit', event => {if (instance && !exiting && window) {event.preventDefault(); window.close();}});
  app.on('window-all-closed', () => app.quit());
}
