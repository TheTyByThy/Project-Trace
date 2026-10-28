// Regenerates the screenshots in docs/images from one real session (by default Tyler's latest COTA stint):
// the Starter workspace's sheets and dialogs for the guides, then every sheet of the built-in FA26 V0.1 and
// Tyre Deg workspaces for the README.
//   npm run doc-images
//   PT_DOC_SESSION="<file.ld>" npm run doc-images      (another session)
//   PT_DOC_BROWSE="<folder of track folders>" …         (the track picker shot; default: the session's driver folder)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchElectron, projectRoot } from './launch.mjs';

const session =
  process.env.PT_DOC_SESSION ||
  path.join(projectRoot, 'myTelemData', 'Tyler', 'COTA', '28102026-213602-Lewis Hamilton-vrc_formula_alpha_2026_csp-cota_2022-layout_f1_2024.ld');
if (!fs.existsSync(session)) {
  console.error(`[doc-images] session not found: ${session}\nSet PT_DOC_SESSION to a .ld or .csv file.`);
  process.exit(1);
}
const browse = process.env.PT_DOC_BROWSE || path.dirname(path.dirname(session));
const images = path.join(projectRoot, 'docs', 'images');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-doc-images-'));

// docs/images name ← screenshot name (from the Starter run).
const STARTER = {
  overview: '01-overview',
  driver: '02-driver',
  tyres: '04-tyres',
  suspension: '08-suspension',
  aero: '09-aero',
  'engine-ers': '10-engine-ers',
  'lap-analysis': '11-lap-analysis',
  'session-setup': '12-session-setup',
  'session-browser-sessions': '00-session-browser',
  'session-browser-tracks': '00-session-browser-tracks',
  'gps-track': 'x-corners-and-gps',
  'properties-graph': 'x-properties-graph',
  'properties-scatter': 'x-properties-scatter',
  'track-profile': 'x-track-profile',
  smoothing: 'x-smoothing',
  'ref-lap-colour': 'x-ref-lap-colour',
  'math-editor': 'x-math-editor',
  'command-palette': 'x-command-palette',
  settings: 'x-settings',
  'zoom-measure': 'x-zoom-measure',
  'fuel-corrected': 'x-fuel-corrected',
  'gg-envelope': 'x-gg-envelope',
  'trend-fit': 'x-trend-fit',
  playback: 'x-playback',
  bars: 'x-bars',
  'bars-combined': 'x-bars-combined',
  datum: 'x-datum',
  'lap-report-delta': 'x-lap-report-delta',
  shortcuts: 'x-shortcuts',
  'time-axis': 'x-time-axis',
  'light-theme': 'x-light-theme',
};

function run(name, env) {
  const out = path.join(work, name);
  fs.mkdirSync(out, { recursive: true });
  console.log(`[doc-images] ${name}…`);
  return new Promise((resolve, reject) => {
    const child = launchElectron({ PT_SCREENSHOT_DIR: out, PT_SCREENSHOT_OPEN: session, ...env });
    child.on('exit', (code) => (code ? reject(new Error(`${name} run exited with ${code}`)) : resolve(out)));
  });
}

/** Capture every sheet of a built-in workspace (loaded as a user workspace under another id, so it isn't hidden by the built-in). */
async function workspaceShots(file, prefix) {
  const ws = JSON.parse(fs.readFileSync(path.join(projectRoot, 'default-workspaces', file), 'utf8'));
  const copy = path.join(work, file);
  fs.writeFileSync(copy, JSON.stringify({ ...ws, id: 'doc-' + prefix, activeSheet: 0 }));
  const out = await run(prefix, { PT_SCREENSHOT_WORKSPACE: copy });
  ws.worksheets.forEach((sh, i) => {
    const slug = sh.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    fs.copyFileSync(path.join(out, `${String(i + 1).padStart(2, '0')}-${slug}.png`), path.join(images, `${prefix}-${slug}.png`));
  });
  return ws.worksheets.length;
}

execSync('npx vite build', { cwd: projectRoot, stdio: 'inherit' });
const starter = await run('starter', { PT_SCREENSHOT_BROWSE: browse });
for (const [img, shot] of Object.entries(STARTER)) fs.copyFileSync(path.join(starter, shot + '.png'), path.join(images, img + '.png'));
const fa26 = await workspaceShots('FA26 V0.1.json', 'fa26');
const deg = await workspaceShots('Tyre Deg.json', 'tyre-deg');
console.log(`[doc-images] updated ${Object.keys(STARTER).length} guide images, ${fa26} FA26 V0.1 and ${deg} Tyre Deg sheets → docs/images (from ${path.basename(session)})`);
