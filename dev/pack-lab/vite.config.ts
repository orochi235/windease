import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Its own dep cache: one shared with Ladle lets whichever server started last invalidate the other.
  cacheDir: fileURLToPath(new URL('../../node_modules/.vite-pack-lab', import.meta.url)),
  resolve: {
    alias: { '#windease': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
  // `::` answers on both loopbacks; with host unset only ::1 does.
  server: { host: '::', port: 61100, strictPort: true },
});
