import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { ApiHealthResponseSchema } from '@dentalai/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const configuredPort = Number(process.env['PORT'] ?? 3000);
  const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 3000;
  const production =
    process.env['NODE_ENV'] === 'production' || process.argv.includes('--production');
  const webRoot = path.resolve(__dirname, '../../web');
  const webDist = path.join(webRoot, 'dist');

  app.use(express.json());

  // API Routes
  app.get('/api/health', (_req, res) => {
    const response = ApiHealthResponseSchema.parse({
      service: 'api',
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
    res.json(response);
  });

  // Vite middleware for development
  if (!production) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      root: webRoot,
      configFile: path.join(webRoot, 'vite.config.ts'),
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`DentalAi Server running on http://localhost:${port}`);
  });
}

startServer().catch((error: unknown) => {
  console.error('DentalAi API failed to start.', error);
  process.exitCode = 1;
});
