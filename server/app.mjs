import { createServer as createHttpServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, openStore } from './store.mjs';

const defaultDist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new ApiError(413, 'Слишком большой запрос.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('Expected object');
    return body;
  } catch {
    throw new ApiError(400, 'Некорректный JSON в запросе.');
  }
}

async function serveStatic(req, res, pathname, distDir) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new ApiError(400, 'Некорректный URL.'); }
  const root = resolve(distDir);
  const requested = resolve(root, `.${decoded}`);
  if (requested !== root && !requested.startsWith(root + sep)) throw new ApiError(404, 'Страница не найдена.');
  let file = requested;
  try {
    if (!(await stat(file)).isFile()) file = resolve(root, 'index.html');
  } catch {
    if (extname(pathname)) throw new ApiError(404, 'Файл не найден.');
    file = resolve(root, 'index.html');
  }
  let body;
  try { body = await readFile(file); } catch { throw new ApiError(404, 'Интерфейс не собран. Выполните npm run build.'); }
  res.writeHead(200, {
    'Content-Type': mimeTypes[extname(file)] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  res.end(req.method === 'HEAD' ? undefined : body);
}

export function createApp({ distDir = defaultDist, ...storeOptions } = {}) {
  const store = openStore(storeOptions);
  const handler = async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true });
      if (req.method === 'GET' && path === '/api/state') return json(res, 200, store.state());
      if (req.method === 'POST' && path === '/api/employees') {
        return json(res, 201, store.addEmployee(await readBody(req)));
      }
      if (req.method === 'POST' && path === '/api/timers/start') {
        return json(res, 201, store.startTimer(await readBody(req)));
      }
      const stop = path.match(/^\/api\/timers\/([^/]+)\/stop$/);
      if (req.method === 'POST' && stop) return json(res, 200, store.stopTimer(stop[1]));
      if (req.method === 'GET' && path === '/api/report') {
        return json(res, 200, store.report({
          from: url.searchParams.get('from') ?? undefined,
          to: url.searchParams.get('to') ?? undefined,
          tz: url.searchParams.get('tz') ?? '0',
          tzStart: url.searchParams.get('tzStart') ?? undefined,
          tzEnd: url.searchParams.get('tzEnd') ?? undefined,
          employeeId: url.searchParams.get('employeeId') ?? undefined,
        }));
      }
      if (path === '/api' || path.startsWith('/api/')) throw new ApiError(404, 'Метод API не найден.');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError(405, 'Метод не поддерживается.');
      await serveStatic(req, res, path, distDir);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (!(error instanceof ApiError)) console.error(error);
      json(res, error instanceof ApiError ? error.status : 500,
        { error: error instanceof ApiError ? error.message : 'Не удалось выполнить запрос. Попробуйте ещё раз.' });
    }
  };
  return { handler, store, close: store.close };
}

export function createServer(options = {}) {
  const app = createApp(options);
  const server = createHttpServer(app.handler);
  return { ...app, server };
}
