const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const required = [
  'app/main/main.js',
  'app/preload/preload.js',
  'app/renderer/index.html',
  'assets/app.ico',
  'package.json'
];

for (const relative of required) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing required project file: ${relative}`);
  }
}

const html = fs.readFileSync(path.join(root, 'app/renderer/index.html'), 'utf8');
for (const marker of ['Backup Centre', 'Restoration', 'Photographs', 'Parts suppliers']) {
  if (!html.includes(marker)) throw new Error(`Renderer missing expected module marker: ${marker}`);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.main !== 'app/main/main.js') throw new Error('package.json main entry is incorrect');
if (!pkg.scripts['build:portable'] || !pkg.scripts['build:installer']) throw new Error('Build scripts are incomplete');

console.log('Project smoke test passed.');

for (const f of ['electron-builder.installer.json','electron-builder.portable.json','scripts/stage-portable-runtime.js']) { if (!fs.existsSync(path.join(root,f))) throw new Error('Missing '+f); }
