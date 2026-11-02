import type { Employee, TimeEntry } from '../types';
import { initials } from '../utils';
import { Icon } from './Icon';

export function Employees({ employees, entries, onTimer }: { employees: Employee[]; entries: TimeEntry[]; onTimer: (id: string) => void }) {
  if (!employees.length) return <div className="empty-state"><Icon name="users" size={32} /><h3>В команде пока никого нет</h3><p>Добавьте первого сотрудника, чтобы начать учитывать время.</p></div>;
  return <section className="employee-list" aria-label="Список сотрудников"><div className="team-heading"><h2>Команда <span>{employees.length}</span></h2><span className="muted">Все данные вымышленные</span></div>
    {employees.map(employee => {
      const active = entries.find(entry => entry.employeeId === employee.id && !entry.stoppedAt);
      return <div className="employee-row" key={employee.id}>
        <span className={`avatar avatar-large ${employee.color}`}>{initials(employee.name)}</span>
        <div className="employee-info"><h3>{employee.name}</h3><p>{employee.role || 'Без должности'}</p></div>
        <div className="employee-activity">{active ? <><span className="running-label"><i className="live-dot" />В работе</span><span className="active-description">{active.description}</span></> : <span className="muted">Таймер не запущен</span>}</div>
        <button className="button button-outline" type="button" onClick={() => onTimer(employee.id)}><Icon name={active ? 'clock' : 'play'} />{active ? 'Открыть таймер' : 'Запустить таймер'}</button>
      </div>;
    })}
  </section>;
}
