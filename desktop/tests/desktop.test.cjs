const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {configure} = require('../updates.cjs');
const {validateRoot} = require('../backend.cjs');
const payload = require('../payload.cjs');
test('manual updates only open the fixed GitHub URL after confirmation', async () => {
  let opened, options;
  const update = configure({version:'0.1.0', showMessage:async value => {options=value; return {response:1};}, openExternal:async url => {opened=url;}});
  await update.open();
  assert.equal(opened, 'https://github.com/orest3781/studioAI/releases/latest');
  assert.match(options.message, /0.1.0/);
  assert.match(options.detail, /do not uninstall/);
  assert.match(options.detail, /security enabled/);
  assert.deepEqual(Object.keys(update), ['open']);
});
test('cancel does not open a browser or install anything', async () => {
  let opened = false;
  await configure({version:'0.1.0', showMessage:async () => ({response:0}), openExternal:async () => {opened=true;}}).open();
  assert.equal(opened, false);
});
test('manual distribution has no automatic updater and preserves data', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.dependencies['electron-updater'], undefined);
  assert.equal(pkg.build.publish, null);
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(pkg.build.nsis.allowElevation, false);
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, false);
});
test('runtime folder must contain installed environment and workspace', () => {
  assert.throws(() => validateRoot('relative'));
  assert.throws(() => validateRoot(path.resolve(__dirname)));
});
test('payload is explicit and excludes private/runtime artifacts', () => {
  assert.equal(new Set(payload).size, payload.length);
  for (const file of payload) {
    assert.ok(!/(history|data\/|models\/|\.venv|\.log|results|\.\.\/)/.test(file), file);
    assert.ok(fs.existsSync(path.join(__dirname, '../../studio', file)), file);
  }
  assert.equal(payload.filter(file => file.startsWith('tests/render-prompts/')).length, 18);
});
