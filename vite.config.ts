import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

// https://vitejs.dev/config/
export default defineConfig({
  // Build-time global constants. __BUILD_DATE__ is captured at the moment
  // vite is invoked, so it ends up baked into the renderer bundle and
  // surfaces in Settings → About without needing a release script.
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().split('T')[0]),
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
      },
      renderer: {},
    }),
  ],
  server: {
    port: 5173,
  },
});
