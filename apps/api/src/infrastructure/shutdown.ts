import type { Server } from 'node:http';

export async function drainServer(
  server: Server,
  closeResources: () => Promise<void>,
  timeoutMs: number,
  closeFrontend: () => Promise<void> = async () => {},
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  try {
    await Promise.race([
      // Vite upgrades/watchers must close during draining. Keep the database/worker alive until
      // existing HTTP handlers finish, so shutdown does not turn in-flight writes into 500s.
      Promise.all([closed, closeFrontend()]).then(closeResources),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Graceful shutdown timed out.')), timeoutMs);
      }),
    ]);
  } catch (error) {
    server.closeAllConnections();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
