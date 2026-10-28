const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const files = require('./payload.cjs');
const target = path.join(__dirname, 'stage', 'studio');
// Delete only the fixed generated staging directory, never the selected runtime.
if (path.resolve(target) !== path.resolve(__dirname, 'stage', 'studio')) throw new Error('Unsafe stage path');
fs.rmSync(target, {recursive: true, force: true});
fs.mkdirSync(target, {recursive: true});
const manifest = {};
for (const file of files) {
  const source = path.join(__dirname, '..', 'studio', file);
  const destination = path.join(target, file);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.copyFileSync(source, destination);
  manifest[file] = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
}
fs.writeFileSync(path.join(target, 'payload-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Staged ${files.length} allowlisted code/recipe files; no runtime or user data.`);
