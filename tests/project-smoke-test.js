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
if (!pkg.scripts['build:setup'] || !pkg.scripts['build:installer']) throw new Error('Setup build scripts are incomplete');
if (pkg.version !== '7.2.0') throw new Error('Expected version 7.2.0');

const main = fs.readFileSync(path.join(root, 'app/main/main.js'), 'utf8');
if (!main.includes('isVersionNewer') || !main.includes("Vintage-Classic-Vehicle-Records/releases/latest")) throw new Error('Update checks are not configured for this repository');
if ((main.match(/ipcMain\.handle\('app:open-bug-report'/g) || []).length !== 1) throw new Error('Bug report IPC handler must be registered exactly once');

const releaseWorkflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'publish-release.yml'), 'utf8');
for (const requiredAsset of ['latest.yml', '.blockmap', 'Verify release tag matches app version']) {
  if (!releaseWorkflow.includes(requiredAsset)) throw new Error(`Release workflow missing ${requiredAsset}`);
}

console.log('Project smoke test passed.');

for (const f of ['electron-builder.installer.json']) { if (!fs.existsSync(path.join(root,f))) throw new Error('Missing '+f); }
