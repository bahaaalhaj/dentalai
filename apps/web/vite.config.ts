import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const repositoryRoot = path.resolve(__dirname, '../..');
  // Read only private directory configuration; never define server values in browser code.
  const privateDirectories = loadEnv(mode, repositoryRoot, 'PRIVATE_');
  return {
    envDir: repositoryRoot,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      fs: {
        // Vite's /@fs/ endpoint must never serve private objects, mailbox tokens or backups.
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem}',
          '**/.git/**',
          '**/.local/**',
          '**/infra/private-objects/**',
          '**/infra/private-mail/**',
          '**/*.{dump,backup}',
          ...Object.values(privateDirectories)
            .filter(Boolean)
            .map((value) => `${path.resolve(value).replaceAll('\\', '/')}/**`),
        ],
      },
      proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: false } },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env['DISABLE_HMR'] !== 'true',
    },
  };
});
