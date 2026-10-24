// Development mode: Vite dev server with hot reload + Electron pointed at it.
//   npm run dev
import { createServer } from 'vite';
import { launchElectron, projectRoot } from './launch.mjs';

const server = await createServer({ root: projectRoot, server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5199/';
console.log(`[dev] renderer at ${url}`);

const child = launchElectron({ PT_DEV_URL: url });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
