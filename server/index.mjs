import { resolve } from 'node:path';
import { createServer } from './app.mjs';

const port = Number(process.env.PORT ?? 4317);
const host = process.env.HOST ?? '127.0.0.1';
const dbPath = process.env.DB_PATH ?? resolve(process.env.DATA_DIR ?? 'data', 'falcon-time.sqlite');
const { server, close } = createServer({ dbPath, seedDemo: process.env.SEED_DEMO !== 'false' });

server.listen(port, host, () => {
  console.log(`Темп: http://${host}:${port}`);
});

function shutdown() {
  server.close(() => { close(); process.exit(0); });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
server.on('error', (error) => {
  console.error(`Не удалось запустить сервер: ${error.message}`);
  close();
  process.exitCode = 1;
});
