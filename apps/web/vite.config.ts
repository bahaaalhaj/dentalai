import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const repositoryRoot = path.resolve(__dirname, '../..');
  const env = loadEnv(mode, repositoryRoot, '');
  return {
    envDir: repositoryRoot,
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(
        env['VITE_SUPABASE_URL'] || env['SUPABASE_URL'] || '',
      ),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(
        env['VITE_SUPABASE_ANON_KEY'] || env['SUPABASE_ANON_KEY'] || '',
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env['DISABLE_HMR'] !== 'true',
    },
  };
});
