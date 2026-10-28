const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const {configure} = require('../updates.cjs');
const {validateRoot} = require('../backend.cjs');
const payload = require('../payload.cjs');
function fixture(prepare = async () => {}) {
  const updater = new EventEmitter();
  const calls = [];
  updater.checkForUpdates = async () => {calls.push('check');};
  updater.downloadUpdate = async () => {calls.push('download');};
  const actions = configure(updater, {confirm: async () => true, inform: message => calls.push(message), prepare, install: () => calls.push('install')});
  return {updater, calls, actions};
}
test('updates cannot download or install implicitly', async () => {
  const {updater, calls, actions} = fixture();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.allowDowngrade, false);
  await actions.apply(); assert.ok(!calls.includes('install'));
  await actions.check(); assert.ok(calls.includes('check')); assert.ok(!calls.includes('download'));
});
test('busy backend blocks install and permits later retry', async () => {
  let busy = true;
  const {updater, calls, actions} = fixture(async () => {if (busy) throw new Error('Queued work');});
  updater.emit('update-downloaded');
  await actions.apply(); assert.ok(!calls.includes('install')); assert.ok(calls.includes('Queued work'));
  busy = false; await actions.apply(); assert.ok(calls.includes('install'));
});
test('update cancellation preserves running backend', async () => {
  const updater = new EventEmitter(); let called = false;
  const actions = configure(updater, {confirm: async () => false, inform: () => {}, prepare: async () => {called = true;}, install: () => {called = true;}});
  updater.emit('update-downloaded'); await actions.apply(); assert.equal(called, false);
});
test('explicit download works and reports errors', async () => {
  const {updater, calls} = fixture();
  updater.emit('update-available', {version: '0.2.0'});
  await new Promise(resolve => setImmediate(resolve)); assert.ok(calls.includes('download'));
  updater.emit('error', new Error('offline')); assert.ok(calls.some(message => message.includes('offline')));
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
