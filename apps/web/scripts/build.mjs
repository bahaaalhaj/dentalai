import { build } from 'vite';

// Root .env configures the backend's development-only mailbox. It must not make
// production web builds ship React's development runtime.
process.env.NODE_ENV = 'production';
await build();
