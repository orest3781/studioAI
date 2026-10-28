'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const BASE = 'http://127.0.0.1:8190';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function validateRoot(root) {
  if (!path.isAbsolute(root)) throw new Error('Choose the full path to your existing AI Video folder.');
  for (const item of ['.venv/Scripts/python.exe', 'ComfyUI/input', 'studio/data']) {
    if (!fs.existsSync(path.join(root, item))) throw new Error(`The selected folder is missing ${item}. Choose your existing AI Video installation.`);
  }
  return path.resolve(root);
}
async function request(route, token, method = 'GET') {
  const response = await fetch(BASE + route, {method, headers: {'X-Studio-Token': token}, signal: AbortSignal.timeout(5000)});
  if (!response.ok) throw new Error(`Studio returned ${response.status}: ${await response.text()}`);
  return response.json();
}
async function portOccupied() {
  const net = require('node:net');
  return new Promise(resolve => {
    const socket = net.connect({host: '127.0.0.1', port: 8190});
    socket.setTimeout(1000);
    socket.once('connect', () => {socket.destroy(); resolve(true);});
    socket.once('error', () => {socket.destroy(); resolve(false);});
    socket.once('timeout', () => {socket.destroy(); resolve(true);});
  });
}
async function stop(token) {
  await request('/api/desktop/shutdown', token, 'POST');
  for (let i = 0; i < 60; i++) {if (!(await portOccupied())) return; await sleep(250);}
  throw new Error('Studio is still finishing its shutdown. Please retry shortly.');
}
async function start({root, code, version, stateFile, logDir}) {
  validateRoot(root);
  if (await portOccupied()) {
    let previous;
    try {previous = JSON.parse(fs.readFileSync(stateFile, 'utf8'));} catch {}
    let identity;
    try {if (previous?.token) identity = await request('/api/desktop', previous.token);} catch {}
    if (!identity || identity.app !== 'studioAI' || path.resolve(identity.workspace).toLowerCase() !== path.resolve(root).toLowerCase()) {
      throw new Error('Another Studio server is using port 8190. Save your edits and finish its queue, then close that server before opening the desktop app. No process was stopped.');
    }
    if (identity.version === version) return {token: previous.token, reused: true};
    await stop(previous.token); // Server atomically refuses shutdown when work is pending.
  }
  const token = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(logDir, {recursive: true});
  fs.writeFileSync(stateFile, JSON.stringify({token}), {mode: 0o600});
  const log = fs.openSync(path.join(logDir, 'backend.log'), 'a');
  const child = spawn(path.join(root, '.venv/Scripts/python.exe'), ['-u', path.join(code, 'server.py')], {
    cwd: root, windowsHide: true, detached: false, stdio: ['ignore', log, log],
    env: {...process.env, PYTHONDONTWRITEBYTECODE: '1', STUDIO_WORKSPACE_ROOT: root, STUDIO_PORT: '8190', STUDIO_DESKTOP_TOKEN: token, STUDIO_DESKTOP_VERSION: version}
  });
  fs.closeSync(log);
  let failure;
  child.on('error', error => {failure = error;});
  child.unref();
  for (let i = 0; i < 120; i++) {
    if (failure) throw failure;
    if (child.exitCode !== null) throw new Error(`Studio could not start. See ${path.join(logDir, 'backend.log')}`);
    try {const info = await request('/api/desktop', token); if (info.app === 'studioAI' && info.version === version) return {token, child};} catch {}
    await sleep(500);
  }
  throw new Error(`Studio took too long to start. See ${path.join(logDir, 'backend.log')}.`);
}
module.exports = {BASE, validateRoot, request, portOccupied, start, stop};
