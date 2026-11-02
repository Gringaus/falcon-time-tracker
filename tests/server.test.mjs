import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from '../server/app.mjs';
import { openStore } from '../server/store.mjs';

const initialNow = Date.parse('2026-11-02T12:00:00Z');

async function fixture(t, options = {}) {
  let now = initialNow;
  const app = createServer({ clock: () => now, ...options });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    app.close();
  });
  async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
    const res = await fetch(origin + path, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    });
    return { status: res.status, body: await res.json() };
  }
  return { ...app, origin, request, advance: (ms) => { now += ms; }, setNow: (value) => { now = Date.parse(value); } };
}

function addEntry(store, employeeId, id, start, stop) {
  store.db.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?)')
    .run(id, employeeId, `Задача ${id}`, Date.parse(start), stop === null ? null : Date.parse(stop));
}

test('employee → start → stop → report round trip with elapsed time from server clock', async (t) => {
  const app = await fixture(t);
  const created = await app.request('/api/employees', { name: '  Тестовый Сотрудник  ', role: ' Разработчик ' });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Тестовый Сотрудник');
  assert.equal(created.body.role, 'Разработчик');
  const started = await app.request('/api/timers/start', { employeeId: created.body.id, description: '  Проверка API ' });
  assert.equal(started.status, 201);
  assert.equal(started.body.stoppedAt, null);
  assert.equal(started.body.description, 'Проверка API');
  app.advance(90_000);
  const stopped = await app.request(`/api/timers/${started.body.id}/stop`, {});
  assert.equal(stopped.status, 200);
  assert.equal(stopped.body.stoppedAt, '2026-11-02T12:01:30.000Z');
  const report = await app.request('/api/report?from=2026-11-02&to=2026-11-02&tz=0');
  assert.equal(report.status, 200);
  assert.equal(report.body.totalMs, 90_000);
  assert.equal(report.body.entries.length, 1);
  assert.equal(report.body.summaries[0].entryCount, 1);
});

test('concurrent repeated starts cannot create two running timers; second stop is a conflict', async (t) => {
  const app = await fixture(t);
  const person = app.store.addEmployee({ name: 'Анна Тестовая' });
  const requests = await Promise.all(Array.from({ length: 6 }, () =>
    app.request('/api/timers/start', { employeeId: person.id, description: 'Конкурентный запуск' })));
  assert.deepEqual(requests.map((res) => res.status).sort(), [201, 409, 409, 409, 409, 409]);
  assert.equal(app.store.entries().length, 1);
  const entry = requests.find((res) => res.status === 201).body;
  app.advance(1_000);
  assert.equal((await app.request(`/api/timers/${entry.id}/stop`, {})).status, 200);
  assert.equal((await app.request(`/api/timers/${entry.id}/stop`, {})).status, 409);
  assert.equal((await app.request('/api/timers/start', { employeeId: person.id, description: 'Следующая задача' })).status, 201);
});

test('SQLite persists employees, completed entries and an active timer after reopening', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'falcon-time-persistence-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'time.sqlite');
  let now = initialNow;
  let store = openStore({ dbPath, clock: () => now });
  const person = store.addEmployee({ name: 'Марк Тестовый' });
  const finished = store.startTimer({ employeeId: person.id, description: 'Готовая задача' });
  now += 30_000;
  store.stopTimer(finished.id);
  const running = store.startTimer({ employeeId: person.id, description: 'Продолжающаяся задача' });
  store.close();
  now += 120_000;
  store = openStore({ dbPath, clock: () => now });
  try {
    assert.equal(store.employees()[0].id, person.id);
    assert.equal(store.entries().length, 2);
    assert.equal(store.entries().find((entry) => entry.id === running.id).stoppedAt, null);
    assert.throws(() => store.startTimer({ employeeId: person.id, description: 'Дубликат' }), { status: 409 });
    assert.equal(store.report({ from: '2026-11-02', to: '2026-11-02' }).totalMs, 150_000);
  } finally { store.close(); }
});

test('empty report has zero totals and includes an employee with no records', async (t) => {
  const app = await fixture(t);
  const first = await app.request('/api/report?from=2026-11-02&to=2026-11-02');
  assert.deepEqual(first.body.entries, []);
  assert.deepEqual(first.body.summaries, []);
  assert.equal(first.body.totalMs, 0);
  const person = app.store.addEmployee({ name: 'София Тестовая' });
  const second = await app.request('/api/report?from=2026-11-02&to=2026-11-02');
  assert.deepEqual(second.body.summaries, [{ employeeId: person.id, totalMs: 0, entryCount: 0 }]);
});

test('reports clip sessions across both date boundaries and exclude adjoining sessions', async (t) => {
  const app = await fixture(t);
  const person = app.store.addEmployee({ name: 'Анна Тестовая' });
  addEntry(app.store, person.id, 'before', '2026-11-01T22:00Z', '2026-11-02T00:00Z');
  addEntry(app.store, person.id, 'cross-start', '2026-11-01T23:00Z', '2026-11-02T01:00Z');
  addEntry(app.store, person.id, 'cross-end', '2026-11-02T23:00Z', '2026-11-03T01:00Z');
  addEntry(app.store, person.id, 'after', '2026-11-03T00:00Z', '2026-11-03T01:00Z');
  const report = app.store.report({ from: '2026-11-02', to: '2026-11-02' });
  assert.equal(report.totalMs, 2 * 3_600_000);
  assert.deepEqual(new Set(report.entries.map((entry) => entry.id)), new Set(['cross-start', 'cross-end']));
});

test('inclusive local dates respect JS timezone offset; live timers only count through now', async (t) => {
  const app = await fixture(t);
  const person = app.store.addEmployee({ name: 'Анна Тестовая' });
  // UTC+4 local midnight is 20:00Z on the preceding UTC date.
  addEntry(app.store, person.id, 'cross-local-start', '2026-11-01T19:00Z', '2026-11-01T21:00Z');
  addEntry(app.store, person.id, 'live', '2026-11-02T11:00Z', null);
  const report = app.store.report({ from: '2026-11-02', to: '2026-11-02', tz: '-240' });
  assert.equal(report.totalMs, 2 * 3_600_000);
  assert.equal(report.entries.find((entry) => entry.id === 'cross-local-start').durationMs, 3_600_000);
  assert.equal(report.entries.find((entry) => entry.id === 'live').durationMs, 3_600_000);
});

test('employee filter isolates records and summaries', async (t) => {
  const app = await fixture(t);
  const first = app.store.addEmployee({ name: 'Первый Сотрудник' });
  const second = app.store.addEmployee({ name: 'Второй Сотрудник' });
  addEntry(app.store, first.id, 'first', '2026-11-02T09:00Z', '2026-11-02T10:00Z');
  addEntry(app.store, second.id, 'second', '2026-11-02T09:00Z', '2026-11-02T11:00Z');
  const report = await app.request(`/api/report?from=2026-11-02&to=2026-11-02&employeeId=${first.id}`);
  assert.equal(report.body.totalMs, 3_600_000);
  assert.deepEqual(report.body.summaries, [{ employeeId: first.id, totalMs: 3_600_000, entryCount: 1 }]);
  assert.equal(report.body.entries[0].employeeId, first.id);
});

test('instant completed and just-started timers appear with zero duration; touching previous tasks are excluded', async (t) => {
  const app = await fixture(t);
  const person = app.store.addEmployee({ name: 'Тестовая Сотрудница' });
  const instant = await app.request('/api/timers/start', { employeeId: person.id, description: 'Мгновенная задача' });
  await app.request(`/api/timers/${instant.body.id}/stop`, {});
  const live = app.store.startTimer({ employeeId: person.id, description: 'Только запущена' });
  addEntry(app.store, person.id, 'touching-before', '2026-11-01T23:00Z', '2026-11-02T00:00Z');
  const report = await app.request('/api/report?from=2026-11-02&to=2026-11-02&tz=0');
  assert.equal(report.body.totalMs, 0);
  assert.equal(report.body.summaries[0].entryCount, 2);
  assert.deepEqual(new Set(report.body.entries.map(entry => entry.id)), new Set([instant.body.id, live.id]));
});

test('DST offsets apply independently to the beginning and end of an inclusive day', async (t) => {
  const app = await fixture(t);
  const person = app.store.addEmployee({ name: 'Тестовый Сотрудник' });
  // Europe/Berlin: March 29, 2026 has 23 hours. UTC+1 at start, UTC+2 at end.
  addEntry(app.store, person.id, 'dst', '2026-03-28T22:00Z', '2026-03-30T00:00Z');
  const report = await app.request('/api/report?from=2026-03-29&to=2026-03-29&tz=-60&tzStart=-60&tzEnd=-120');
  assert.equal(report.status, 200);
  assert.equal(report.body.totalMs, 23 * 3_600_000);
  const invalid = await app.request('/api/report?from=2026-03-29&to=2026-03-29&tzStart=bad');
  assert.equal(invalid.status, 400);
});

test('validation rejects missing names, task descriptions, nonexistent employees and invalid dates', async (t) => {
  const app = await fixture(t);
  for (const body of [{}, { name: ' ' }, { name: 'x'.repeat(81) }, { name: 123 }]) {
    assert.equal((await app.request('/api/employees', body)).status, 400);
  }
  const person = app.store.addEmployee({ name: 'Анна Тестовая' });
  for (const body of [{}, { employeeId: person.id, description: ' ' }, { employeeId: person.id, description: 'x'.repeat(501) }]) {
    assert.equal((await app.request('/api/timers/start', body)).status, 400);
  }
  assert.equal((await app.request('/api/timers/start', { employeeId: 'missing', description: 'Задача' })).status, 404);
  assert.equal((await app.request('/api/timers/missing/stop', {})).status, 404);
  for (const query of [
    'from=2026-02-30&to=2026-11-02',
    'from=2026-11-03&to=2026-11-02',
    'from=2026-11-02',
    'from=2026-11-02&to=2026-11-02&tz=oops',
    'from=2026-11-02&to=2026-11-02&tz=841',
  ]) {
    const result = await app.request('/api/report?' + query);
    assert.equal(result.status, 400, query);
    assert.equal(typeof result.body.error, 'string');
  }
});

test('malformed JSON and non-object bodies are rejected without changing data', async (t) => {
  const app = await fixture(t);
  for (const body of ['{oops', 'null', '[]', '123']) {
    const result = await fetch(app.origin + '/api/employees', { method: 'POST', body });
    assert.equal(result.status, 400);
  }
  assert.equal(app.store.employees().length, 0);
});

test('demo seed is fictional and runs only once for a persisted database', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'falcon-time-seed-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'time.sqlite');
  let store = openStore({ dbPath, seedDemo: true, clock: () => initialNow });
  assert.equal(store.employees().length, 3);
  assert.equal(store.entries().length, 4);
  store.close();
  store = openStore({ dbPath, seedDemo: true });
  assert.equal(store.employees().length, 3);
  assert.equal(store.entries().length, 4);
  store.close();
});

test('production server serves the frontend, deep links and assets with correct content types', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'falcon-time-static-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>Falcon Time</title>');
  await writeFile(join(dir, 'assets/app.js'), 'console.log("app")');
  const app = await fixture(t, { distDir: dir });
  for (const path of ['/', '/report']) {
    const response = await fetch(app.origin + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(await response.text(), /Falcon Time/);
  }
  const asset = await fetch(app.origin + '/assets/app.js');
  assert.match(asset.headers.get('content-type'), /^text\/javascript/);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(app.origin + '/missing.js')).status, 404);
  assert.equal((await app.request('/api/missing')).status, 404);
});
