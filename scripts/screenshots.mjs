// Launches Project-Trace in automation mode, opens the bundled sample session and saves a PNG of
// every worksheet (plus a few dialogs) to ./screenshots-out — used to verify the UI and for docs.
//   npm run screenshots
//   PT_SCREENSHOT_BROWSE="<car folder>" npm run screenshots   (also captures the track picker)
import path from 'node:path';
import { launchElectron, projectRoot } from './launch.mjs';

const out = process.env.PT_SCREENSHOT_DIR || path.join(projectRoot, 'screenshots-out');
const child = launchElectron({ PT_SCREENSHOT_DIR: out });
child.on('exit', (code) => {
  console.log(`[screenshots] done (exit ${code}) → ${out}`);
  process.exit(code ?? 0);
});
