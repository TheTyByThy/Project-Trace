// Makes sure dependencies are installed *for this OS/CPU*. A project folder copied between Windows
// and macOS carries the other platform's Electron/esbuild binaries in node_modules, which won't run;
// in that case node_modules is rebuilt. Used by the double-click launchers.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const nodeModules = path.join(root, 'node_modules');
const marker = path.join(nodeModules, '.project-trace-platform');
const want = `${process.platform}-${process.arch}`;

const read = (p) => {
  try {
    return fs.readFileSync(p, 'utf8').trim();
  } catch {
    return '';
  }
};

function electronLooksNative() {
  const rel = read(path.join(nodeModules, 'electron', 'path.txt'));
  if (!rel || !fs.existsSync(path.join(nodeModules, 'electron', 'dist', rel))) return false;
  if (process.platform === 'darwin') return rel.includes('Electron.app');
  if (process.platform === 'win32') return rel.toLowerCase().endsWith('.exe');
  return !rel.includes('Electron.app') && !rel.toLowerCase().endsWith('.exe');
}

const have = read(marker);
const ok = fs.existsSync(nodeModules) && (have ? have === want : electronLooksNative()) && electronLooksNative();

if (!ok) {
  if (fs.existsSync(nodeModules) && ((have && have !== want) || !electronLooksNative())) {
    console.log(`  Dependencies were installed for a different system (${have || 'unknown'}); reinstalling for ${want}…`);
    fs.rmSync(nodeModules, { recursive: true, force: true });
  } else {
    console.log('  First run: installing Project-Trace (about a minute, needs internet)…');
  }
  execSync('npm install', { cwd: root, stdio: 'inherit' });
}
fs.mkdirSync(nodeModules, { recursive: true });
fs.writeFileSync(marker, want);
