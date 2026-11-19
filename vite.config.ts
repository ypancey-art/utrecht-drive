import { defineConfig, type Plugin } from 'vite';

// Content Security Policy for the published game (not the dev server, which injects its own
// scripts). Only our own files, plus the two multiplayer relays. 'wasm-unsafe-eval' lets the
// physics engine (Rapier) and the mesh decoder start their WebAssembly.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  // blob:/data: — the 3D model loader fetches embedded textures through blob: URLs.
  "connect-src 'self' blob: data: wss://broker.hivemq.com:8884 wss://broker.emqx.io:8084",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// Relative base so the build works both locally and on GitHub Pages (/utrecht-drive/).
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      output: {
        // Libraries in their own files: they rarely change, so browsers keep them cached
        // across game updates (only the game's own code is downloaded again).
        manualChunks: (id: string) => (id.includes('@dimforge/rapier') ? 'rapier' : id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
  plugins: [csp()],
});
