// Starts Electron with a clean environment. Terminals inside VS Code (itself an Electron app) set
// ELECTRON_RUN_AS_NODE=1, which would make Electron behave like plain Node and fail to open a window.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
export const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function launchElectron(extraEnv = {}, args = []) {
  const electron = require('electron');
  const env = { ...process.env, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  return spawn(electron, [projectRoot, ...args], { stdio: 'inherit', env });
}

// `node scripts/launch.mjs` → run the built app.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const child = launchElectron({}, process.argv.slice(2));
  child.on('exit', (code) => process.exit(code ?? 0));
}
