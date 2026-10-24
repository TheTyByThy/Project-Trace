import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The renderer is served from the custom `app://` protocol in production (see electron/main.cjs),
// so relative asset paths keep everything portable across Windows and macOS.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
} as any);
