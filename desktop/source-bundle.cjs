const fs = require('node:fs');
const path = require('node:path');
const files = require('./payload.cjs').map(file => `studio/${file}`);
files.push(...['package.json','package-lock.json','main.cjs','backend.cjs','updates.cjs','stage.cjs','payload.cjs','source-bundle.cjs','README.md','.gitignore','tests/desktop.test.cjs','tests/packaged_backend.py'].map(file => `desktop/${file}`), '.github/workflows/release.yml');
const target = path.join(__dirname, 'source-release');
files.push(...['signing.cjs','release.cjs','verify-release.ps1','tests/signing.test.cjs'].map(file => `desktop/${file}`));
for (const file of files) {
  const destination = path.join(target, file);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.copyFileSync(path.join(__dirname, '..', file), destination);
}
fs.writeFileSync(path.join(target, '.gitignore'), 'desktop/node_modules/\ndesktop/dist/\ndesktop/stage/\ndesktop/source-release/\n**/__pycache__/\n');
console.log(`Prepared ${files.length} explicit source files in ${target}. No local runtime data included.`);
