import { useEffect, useId, useState } from 'react';
import type { Employee, ReportData, TimeEntry } from '../types';
import { formatDuration, formatClock, formatDate, localDate, initials } from '../utils';
import { api } from '../api';
import { Icon } from './Icon';

type Props = { employees: Employee[]; refreshKey: number; onError?: (message: string) => void };
type Period = 'today' | 'week' | 'month' | 'custom';
type Tab = 'entries' | 'employees';

function presetDates(period: Exclude<Period, 'custom'>) {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  if (period === 'week') start.setDate(start.getDate() - 6);
  if (period === 'month') start.setDate(1);
  return { from: localDate(start), to: localDate(end) };
}

function csvCell(value: string | number) {
  const text = String(value);
  const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function EmployeeName({ employee }: { employee?: Employee }) {
  if (!employee) return <span>Неизвестный сотрудник</span>;
  return <span className="employee-name"><span className={`avatar ${employee.color}`}>{initials(employee.name)}</span><span>{employee.name}</span></span>;
}

function EntryRow({ entry, employee, duration }: { entry: TimeEntry; employee?: Employee; duration: number }) {
  return <tr>
    <td><span className="task-title">{entry.description}</span><span className={`task-status ${entry.stoppedAt ? '' : 'is-running'}`}>{entry.stoppedAt ? 'Завершено' : 'В работе'}</span></td>
    <td><EmployeeName employee={employee} /></td>
    <td className="nowrap">{formatDate(entry.startedAt)}</td>
    <td className="nowrap">{formatClock(entry.startedAt)} — {entry.stoppedAt ? formatClock(entry.stoppedAt) : 'сейчас'}</td>
    <td className="duration-cell">{formatDuration(duration)}</td>
  </tr>;
}

export function Report({ employees, refreshKey }: Props) {
  const id = useId();
  const [period, setPeriod] = useState<Period>('week');
  const [range, setRange] = useState(() => presetDates('week'));
  const [employeeId, setEmployeeId] = useState('');
  const [tab, setTab] = useState<Tab>('entries');
  const [result, setResult] = useState<{ key: string; data: ReportData; clockOffset: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(Date.now());
  const { from, to } = range;
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  const invalid = !from || !to || from > to || !Number.isFinite(+start) || !Number.isFinite(+end);
  const query = new URLSearchParams({ from, to, tz: String(start.getTimezoneOffset()), tzStart: String(start.getTimezoneOffset()), tzEnd: String(end.getTimezoneOffset()) });
  if (employeeId) query.set('employeeId', employeeId);
  const key = query.toString();
  const data = result?.key === key && !invalid ? result.data : null;

  useEffect(() => {
    const poll = window.setInterval(() => setReload(value => value + 1), 15_000);
    const onFocus = () => setReload(value => value + 1);
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(poll); window.removeEventListener('focus', onFocus); };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (invalid) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<ReportData>(`/api/report?${key}`, { signal: controller.signal })
      .then(next => {
        if (!controller.signal.aborted) setResult({ key, data: next, clockOffset: Date.parse(next.serverNow) - Date.now() });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Не удалось загрузить отчёт');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [key, invalid, refreshKey, reload]);

  const employeeMap = new Map(employees.map(employee => [employee.id, employee]));
  const durationFor = (entry: TimeEntry & { durationMs: number }) => entry.stoppedAt ? entry.durationMs : Math.max(0, Math.min(now + (result?.clockOffset ?? 0), +end) - Math.max(Date.parse(entry.startedAt), +start));
  const totals = new Map<string, number>();
  let totalMs = 0;
  for (const entry of data?.entries ?? []) {
    const duration = durationFor(entry);
    totalMs += duration;
    totals.set(entry.employeeId, (totals.get(entry.employeeId) ?? 0) + duration);
  }

  function choosePreset(next: Exclude<Period, 'custom'>) {
    setPeriod(next);
    setRange(presetDates(next));
  }

  function download() {
    if (!data || invalid || error || loading) return;
    const rows: (string | number)[][] = tab === 'entries'
      ? [['Задача', 'Сотрудник', 'Начало', 'Окончание', 'Длительность (секунды)', 'Статус'], ...data.entries.map(entry => [entry.description, employeeMap.get(entry.employeeId)?.name ?? '', entry.startedAt, entry.stoppedAt ?? '', Math.floor(durationFor(entry) / 1000), entry.stoppedAt ? 'Завершено' : 'В работе'])]
      : [['Сотрудник', 'Должность', 'Записей', 'Длительность (секунды)'], ...data.summaries.map(summary => [employeeMap.get(summary.employeeId)?.name ?? '', employeeMap.get(summary.employeeId)?.role ?? '', summary.entryCount, Math.floor((totals.get(summary.employeeId) ?? 0) / 1000)])];
    const url = URL.createObjectURL(new Blob(['\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `temp-${tab}-${from}-${to}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="report-section" aria-labelledby={`${id}-title`}>
    <div className="section-heading"><h2 id={`${id}-title`}>Отчёт по времени</h2><button className="button button-secondary" onClick={download} disabled={!data || loading || invalid || !!error}><Icon name="download" />Скачать CSV</button></div>
    <div className="report-filters">
      <div className="period-switch" aria-label="Период отчёта">{([['today', 'Сегодня'], ['week', 'Неделя'], ['month', 'Месяц']] as const).map(([value, label]) => <button key={value} aria-pressed={period === value} className={period === value ? 'active' : ''} onClick={() => choosePreset(value)}>{label}</button>)}</div>
      <label className="date-filter"><span>От</span><input aria-label="Начало периода" type="date" value={from} min="1900-01-01" max="9999-12-31" onChange={event => { setPeriod('custom'); setRange({ ...range, from: event.target.value }); }} /></label>
      <label className="date-filter"><span>До</span><input aria-label="Конец периода" type="date" value={to} min="1900-01-01" max="9999-12-31" onChange={event => { setPeriod('custom'); setRange({ ...range, to: event.target.value }); }} /></label>
      <select aria-label="Сотрудник в отчёте" value={employeeId} onChange={event => setEmployeeId(event.target.value)}><option value="">Все сотрудники</option>{employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select>
    </div>
    {invalid ? <p className="inline-error" role="alert">Укажите обе даты. Начало периода должно быть не позже окончания.</p> : null}
    {error ? <div className="report-error" role="alert"><span>{error}</span><button className="text-button" onClick={() => setReload(value => value + 1)}>Повторить</button></div> : null}
    <dl className="report-stats" aria-busy={loading}>
      <div><dt>Всего за период</dt><dd>{data ? formatDuration(totalMs) : '—'}</dd></div>
      <div><dt>Записей</dt><dd>{data?.entries.length ?? '—'}</dd></div>
      <div><dt>Сотрудников</dt><dd>{data?.summaries.length ?? '—'}</dd></div>
    </dl>
    <div className="report-table-panel" aria-busy={loading}>
      <div className="report-tabs" aria-label="Представление отчёта">{([['entries', 'Записи'], ['employees', 'По сотрудникам']] as const).map(([value, label]) => <button key={value} className={tab === value ? 'active' : ''} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}{loading ? <span className="report-loading" role="status">Обновляем…</span> : null}</div>
      {!data ? <div className="empty-state"><Icon name="clock" /><h3>{invalid ? 'Выберите период' : error ? 'Отчёт недоступен' : 'Загружаем отчёт'}</h3><p>{invalid ? 'Укажите корректные даты в фильтрах выше.' : error ? 'Повторите загрузку, чтобы увидеть записи.' : 'Собираем записи рабочего времени.'}</p></div>
        : tab === 'entries' && data.entries.length === 0 ? <div className="empty-state"><Icon name="clock" /><h3>За этот период записей нет</h3><p>Выберите другой период или запустите таймер новой задачи.</p></div>
          : <div className="table-scroll" role="region" aria-label={tab === 'entries' ? 'Записи рабочего времени' : 'Итоги по сотрудникам'} tabIndex={0}>
            {tab === 'entries' ? <table><thead><tr><th scope="col">Задача</th><th scope="col">Сотрудник</th><th scope="col">Дата</th><th scope="col">Время</th><th scope="col" className="duration-cell">Длительность</th></tr></thead><tbody>{data.entries.map(entry => <EntryRow key={entry.id} entry={entry} employee={employeeMap.get(entry.employeeId)} duration={durationFor(entry)} />)}</tbody></table>
              : data.summaries.length ? <table><thead><tr><th scope="col">Сотрудник</th><th scope="col">Должность</th><th scope="col">Записей</th><th scope="col" className="duration-cell">Общее время</th></tr></thead><tbody>{data.summaries.map(summary => <tr key={summary.employeeId}><td><EmployeeName employee={employeeMap.get(summary.employeeId)} /></td><td>{employeeMap.get(summary.employeeId)?.role || 'Не указана'}</td><td>{summary.entryCount}</td><td className="duration-cell">{formatDuration(totals.get(summary.employeeId) ?? 0)}</td></tr>)}</tbody></table>
                : <div className="empty-state"><Icon name="users" /><h3>Сотрудников пока нет</h3><p>Добавьте первого сотрудника, чтобы начать учёт времени.</p></div>}
          </div>}
      {data ? <p className="table-footer">Показаны все {tab === 'entries' ? 'записи' : 'сотрудники'} за выбранный период</p> : null}
    </div>
  </section>;
}
