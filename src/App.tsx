import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, Employee } from './types';
import { api } from './api';
import { Icon } from './components/Icon';
import { TimerPanel } from './components/TimerPanel';
import { Report } from './components/Report';
import { Employees } from './components/Employees';
import { EmployeeModal } from './components/EmployeeModal';

export default function App() {
  const [data, setData] = useState<AppState | null>(null);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [view, setView] = useState<'time' | 'employees'>('time');
  const [modalOpen, setModalOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [serverOffset, setServerOffset] = useState(0);
  const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    try {
      const next = await api<AppState>('/api/state', { signal: abort.signal });
      if (id !== requestId.current) return;
      setData(next); setError(''); setServerOffset(Date.parse(next.serverNow) - Date.now());
      setSelectedId(current => next.employees.some(employee => employee.id === current) ? current : next.employees[0]?.id ?? '');
      setRevision(value => value + 1);
    } catch (err) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : 'Нет соединения с сервером.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    const focus = () => { void refresh(); };
    window.addEventListener('focus', focus);
    return () => { clearInterval(interval); window.removeEventListener('focus', focus); controller.current?.abort(); };
  }, [refresh]);
  useEffect(() => { document.title = `${view === 'time' ? 'Рабочее время' : 'Сотрудники'} — Темп`; }, [view]);

  async function createEmployee(name: string, role: string) {
    const employee = await api<Employee>('/api/employees', { method: 'POST', body: JSON.stringify({ name, role }) });
    await refresh(); setSelectedId(employee.id);
  }

  return <div className="app-shell">
    <a className="skip-link" href="#main">К содержимому</a>
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); setView('time'); }} aria-label="Темп — главная"><Icon name="clock" size={43} /><div><span>Темп</span><small>Учёт рабочего времени</small></div></a>
      <nav className="navigation" aria-label="Основная навигация">
        <button className={view === 'time' ? 'selected' : ''} aria-current={view === 'time' ? 'page' : undefined} onClick={() => setView('time')}><Icon name="clock" size={23} />Учёт времени</button>
        <button className={view === 'employees' ? 'selected' : ''} aria-current={view === 'employees' ? 'page' : undefined} onClick={() => setView('employees')}><Icon name="users" size={23} />Сотрудники</button>
      </nav>
      <div className="sidebar-footer"><span>Демо-команда</span><small>Все данные вымышленные</small></div>
    </aside>
    <main id="main" className="main-content">
      <header className="page-heading"><div><h1>{view === 'time' ? 'Рабочее время' : 'Сотрудники'}</h1><p>{view === 'time' ? 'Команда, задачи и время — в одном ритме.' : 'Люди, с которыми вы создаёте результат.'}</p></div><button className="button button-outline add-employee" onClick={() => setModalOpen(true)}><Icon name="plus" />Добавить сотрудника</button></header>
      {error && <div className="error-banner" role="alert"><span>Не удалось обновить данные. {error}</span><button className="button button-outline" onClick={() => void refresh()}><Icon name="refresh" />Повторить</button></div>}
      {!data ? !error && <div className="loading-state" role="status"><span className="spinner" />Загружаем рабочее пространство…</div> : view === 'time' ? <>
        <TimerPanel employees={data.employees} entries={data.entries} selectedId={selectedId} onSelect={setSelectedId} onRefresh={refresh} serverOffset={serverOffset} />
        <Report employees={data.employees} refreshKey={revision} />
      </> : <Employees employees={data.employees} entries={data.entries} onTimer={id => { setSelectedId(id); setView('time'); }} />}
    </main>
    {modalOpen && <EmployeeModal onClose={() => setModalOpen(false)} onCreate={createEmployee} />}
  </div>;
}
