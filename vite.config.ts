import React from '@vitejs/plugin-react-refresh'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    React(),
  ],
  // relative asset URLs: the HTTP server's page also works under a sub-path,
  // e.g. a port forwarded by VS Code Remote as https://host/proxy/8100/
  base: './',
  build: {
    outDir: 'dist/client',
  },
})
