import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../server/app.mjs';

const directory = mkdtempSync(join(tmpdir(), 'falcon-time-e2e-'));
const { server, close } = createServer({ dbPath: join(directory, 'test.sqlite'), seedDemo: true });
server.listen(4318, '127.0.0.1');
function stop() {
  server.close(() => { close(); rmSync(directory, { recursive: true, force: true }); process.exit(0); });
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
server.on('error', error => { console.error(error); close(); rmSync(directory, { recursive: true, force: true }); process.exit(1); });
