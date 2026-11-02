import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

export function EmployeeModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, role: string) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => { dialog.current?.showModal(); nameInput.current?.focus(); }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError('Укажите имя сотрудника.'); return; }
    setPending(true); setError('');
    try { await onCreate(name.trim(), role.trim()); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось добавить сотрудника.'); setPending(false); }
  }
  return <dialog ref={dialog} className="employee-dialog" aria-labelledby="employee-dialog-title" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }} onClick={event => {
    const box = event.currentTarget.getBoundingClientRect();
    const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    if (event.target === event.currentTarget && outside && !pending) onClose();
  }}>
    <form onSubmit={submit}>
      <div className="dialog-heading"><h2 id="employee-dialog-title">Новый сотрудник</h2><button className="icon-button" type="button" aria-label="Закрыть" onClick={onClose} disabled={pending}><Icon name="close" /></button></div>
      <p>Добавьте человека в вашу демо-команду.</p>
      <label className="field">Имя и фамилия<input ref={nameInput} value={name} onChange={event => setName(event.target.value)} placeholder="Например, Иван Соколов" minLength={2} maxLength={80} required disabled={pending} /></label>
      <label className="field">Должность <span className="optional">необязательно</span><input value={role} onChange={event => setRole(event.target.value)} placeholder="Например, разработчик" maxLength={80} disabled={pending} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="button button-outline" type="button" onClick={onClose} disabled={pending}>Отмена</button><button className="button button-primary" type="submit" disabled={pending}>{pending ? 'Добавляем…' : 'Добавить'}</button></div>
    </form>
  </dialog>;
}
