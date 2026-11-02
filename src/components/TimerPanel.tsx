import { useEffect, useState } from 'react';
import type { Employee, TimeEntry } from '../types';
import { api } from '../api';
import { timerDigits } from '../utils';
import { Icon } from './Icon';

interface Props {
  employees: Employee[]; entries: TimeEntry[]; selectedId: string;
  onSelect: (id: string) => void; onRefresh: () => Promise<void>; serverOffset: number;
}

export function TimerPanel({ employees, entries, selectedId, onSelect, onRefresh, serverOffset }: Props) {
  const [description, setDescription] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const active = entries.find(entry => entry.employeeId === selectedId && !entry.stoppedAt);
  const running = entries.filter(entry => !entry.stoppedAt);
  useEffect(() => {
    if (!running.length) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [running.length]);
  useEffect(() => { setError(''); setDescription(''); setNow(Date.now()); }, [selectedId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError('');
    try {
      if (active) {
        await api(`/api/timers/${active.id}/stop`, { method: 'POST' });
        setDescription('');
      } else {
        await api('/api/timers/start', { method: 'POST', body: JSON.stringify({ employeeId: selectedId, description: description.trim() }) });
      }
      setNow(Date.now());
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить таймер.');
      await onRefresh();
    } finally { setPending(false); }
  }

  return <section className="timer-panel" aria-labelledby="timer-title">
    <div className="section-intro"><h2 id="timer-title">{active ? 'Задача в работе' : 'Новая задача'}</h2><p>{active ? 'Остановите таймер, когда закончите задачу' : 'Выберите сотрудника и начните отсчёт'}</p></div>
    <form className="timer-form" onSubmit={submit}>
      <label className="field employee-select">Сотрудник
        <select aria-label="Сотрудник" value={selectedId} onChange={event => onSelect(event.target.value)} disabled={!employees.length || pending} required>
          {!employees.length && <option value="">Сначала добавьте сотрудника</option>}
          {employees.map(employee => <option key={employee.id} value={employee.id}>{employee.name}{entries.some(entry => entry.employeeId === employee.id && !entry.stoppedAt) ? ' · в работе' : ''}</option>)}
        </select>
      </label>
      <label className="field task-field">Над чем работаете?
        <input placeholder="Например, подготовка макета" value={active?.description ?? description} onChange={event => setDescription(event.target.value)} maxLength={500} required={!active} readOnly={!!active} disabled={pending || !employees.length} />
      </label>
      <div className={`timer-readout ${active ? 'is-running' : ''}`}>
        <span className="timer-digits" role="timer" aria-label="Время текущей задачи">{timerDigits(active ? now + serverOffset - Date.parse(active.startedAt) : 0)}</span>
        <span className="timer-status">{active ? <><i className="live-dot" />Таймер запущен</> : 'Готов к работе'}</span>
      </div>
      <button className={`button ${active ? 'button-stop' : 'button-primary'} timer-submit`} type="submit" disabled={pending || !employees.length}>
        <Icon name={active ? 'stop' : 'play'} />{pending ? 'Сохраняем…' : active ? 'Остановить' : 'Начать'}
      </button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="timer-tip"><Icon name="clock" /><span>У каждого сотрудника может быть только один активный таймер</span></div>
    {running.some(entry => entry.employeeId !== selectedId) && <div className="other-timers">
      <span>Также в работе:</span>{running.filter(entry => entry.employeeId !== selectedId).map(entry => <button className="running-person" type="button" key={entry.id} onClick={() => onSelect(entry.employeeId)}><i className="live-dot" />{employees.find(employee => employee.id === entry.employeeId)?.name}<span>{timerDigits(now + serverOffset - Date.parse(entry.startedAt))}</span></button>)}
    </div>}
  </section>;
}
