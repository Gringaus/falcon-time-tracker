import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const colors = ['sage', 'blue', 'lavender', 'peach', 'rose'];
const dayMs = 86_400_000;
const asEmployee = (row) => ({ ...row });
const asEntry = (row) => ({
  id: row.id,
  employeeId: row.employee_id,
  description: row.description,
  startedAt: new Date(row.started_at).toISOString(),
  stoppedAt: row.stopped_at === null ? null : new Date(row.stopped_at).toISOString(),
});

function textField(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new ApiError(400, `${label}: от ${min} до ${max} символов.`);
  }
  return value.trim();
}

function calendarDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, `${label}: укажите дату в формате ГГГГ-ММ-ДД.`);
  }
  const epoch = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, `${label}: такой даты не существует.`);
  }
  return epoch;
}

export function openStore({ dbPath = ':memory:', seedDemo = false, clock = Date.now } = {}) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 2 AND 80),
      role TEXT NOT NULL DEFAULT '' CHECK(length(role) <= 80),
      color TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL REFERENCES employees(id),
      description TEXT NOT NULL CHECK(length(trim(description)) BETWEEN 1 AND 500),
      started_at INTEGER NOT NULL,
      stopped_at INTEGER CHECK(stopped_at IS NULL OR stopped_at >= started_at)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_running_timer_per_employee
      ON entries(employee_id) WHERE stopped_at IS NULL;
    CREATE INDEX IF NOT EXISTS entries_by_employee_and_start
      ON entries(employee_id, started_at);
  `);

  const employees = () => db.prepare('SELECT * FROM employees ORDER BY rowid').all().map(asEmployee);
  const entries = () => db.prepare('SELECT * FROM entries ORDER BY started_at DESC, rowid DESC').all().map(asEntry);
  const employee = (id) => {
    const row = db.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, 'Сотрудник не найден.');
    return asEmployee(row);
  };

  function addEmployee(input) {
    const name = textField(input.name, 'Имя сотрудника', 2, 80);
    const role = textField(input.role ?? '', 'Должность', 0, 80);
    const color = colors[db.prepare('SELECT count(*) AS total FROM employees').get().total % colors.length];
    const result = { id: randomUUID(), name, role, color };
    db.prepare('INSERT INTO employees (id, name, role, color) VALUES (?, ?, ?, ?)')
      .run(result.id, name, role, color);
    return result;
  }

  function startTimer(input) {
    if (typeof input.employeeId !== 'string') throw new ApiError(400, 'Выберите сотрудника.');
    employee(input.employeeId);
    const description = textField(input.description, 'Описание задачи', 1, 500);
    const id = randomUUID();
    try {
      db.prepare('INSERT INTO entries (id, employee_id, description, started_at) VALUES (?, ?, ?, ?)')
        .run(id, input.employeeId, description, clock());
    } catch (error) {
      if (error.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed: entries.employee_id/.test(error.message)) {
        throw new ApiError(409, 'У сотрудника уже запущен таймер. Сначала остановите его.');
      }
      throw error;
    }
    return asEntry(db.prepare('SELECT * FROM entries WHERE id = ?').get(id));
  }

  function stopTimer(id) {
    const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, 'Таймер не найден.');
    if (row.stopped_at !== null) throw new ApiError(409, 'Этот таймер уже остановлен.');
    const stoppedAt = Math.max(clock(), row.started_at);
    db.prepare('UPDATE entries SET stopped_at = ? WHERE id = ? AND stopped_at IS NULL').run(stoppedAt, id);
    return asEntry(db.prepare('SELECT * FROM entries WHERE id = ?').get(id));
  }

  function report({ from, to, tz = '0', tzStart = tz, tzEnd = tz, employeeId } = {}) {
    const fromDay = calendarDate(from, 'Начало периода');
    const toDay = calendarDate(to, 'Конец периода');
    if (fromDay > toDay) throw new ApiError(400, 'Начало периода должно быть не позже окончания.');
    if ([tz, tzStart, tzEnd].some(value => typeof value !== 'string' || !/^-?\d+$/.test(value) || Number(value) < -840 || Number(value) > 840)) {
      throw new ApiError(400, 'Некорректное смещение часового пояса.');
    }
    if (employeeId !== undefined) employee(employeeId);
    const start = fromDay + Number(tzStart) * 60_000;
    const end = toDay + dayMs + Number(tzEnd) * 60_000;
    if (end <= start) throw new ApiError(400, 'Некорректные границы периода и часового пояса.');
    const now = clock();
    const selectedEmployees = employeeId ? [employee(employeeId)] : employees();
    const rows = db.prepare(`SELECT * FROM entries
      WHERE started_at < ? AND COALESCE(stopped_at, ?) >= ?
      ${employeeId ? 'AND employee_id = ?' : ''}
      ORDER BY started_at DESC, rowid DESC`)
      .all(...(employeeId ? [end, now, start, employeeId] : [end, now, start]));
    const resultEntries = rows.map((row) => ({
      ...asEntry(row),
      durationMs: Math.max(0, Math.min(row.stopped_at ?? now, end) - Math.max(row.started_at, start)),
    })).filter((row) => row.durationMs > 0 || (Date.parse(row.startedAt) >= start && Date.parse(row.startedAt) < end));
    const totals = new Map(selectedEmployees.map((row) => [row.id, { employeeId: row.id, totalMs: 0, entryCount: 0 }]));
    for (const entry of resultEntries) {
      const summary = totals.get(entry.employeeId);
      summary.totalMs += entry.durationMs;
      summary.entryCount += 1;
    }
    const summaries = [...totals.values()];
    return {
      entries: resultEntries,
      summaries,
      totalMs: summaries.reduce((sum, row) => sum + row.totalMs, 0),
      from,
      to,
      serverNow: new Date(now).toISOString(),
    };
  }

  if (seedDemo && !db.prepare('SELECT 1 FROM employees LIMIT 1').get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const demo = [
        ['Анна Смирнова', 'Дизайнер', 'Прототип личного кабинета', 2, 95],
        ['Михаил Волков', 'Разработчик', 'Проверка API', 3, 120],
        ['Елена Морозова', 'Проджект-менеджер', 'Планирование спринта', 4, 45],
      ];
      demo.forEach(([name, role, description, hoursAgo, minutes]) => {
        const person = addEmployee({ name, role });
        const started = clock() - hoursAgo * 3_600_000;
        db.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?)')
          .run(randomUUID(), person.id, description, started, started + minutes * 60_000);
      });
      const person = employees()[0];
      const started = clock() - dayMs - 4 * 3_600_000;
      db.prepare('INSERT INTO entries VALUES (?, ?, ?, ?, ?)')
        .run(randomUUID(), person.id, 'Подготовка макета', started, started + 80 * 60_000);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }

  return {
    db,
    employees,
    entries,
    addEmployee,
    startTimer,
    stopTimer,
    report,
    state: () => ({ employees: employees(), entries: entries(), serverNow: new Date(clock()).toISOString() }),
    close: () => db.close(),
  };
}
