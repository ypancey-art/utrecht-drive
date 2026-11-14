import { defineConfig } from 'vite';

// Relative base so the build works both locally and on GitHub Pages (/utrecht-drive/).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 6000 },
});
