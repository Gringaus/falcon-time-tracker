import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('employee → persistent timer → report, CSV and empty period; mobile layout', async ({ page, request }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const suffix = Date.now();
  const name = `Тестовый Сотрудник ${suffix}`;
  const task = `Проверка API, «таймер» ${suffix}`;

  await page.goto('/');
  await expect(page).toHaveTitle('Рабочее время — Темп');
  await expect(page.getByRole('heading', { name: 'Рабочее время', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Новая задача', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/falcon-time-desktop.png' });

  await page.getByRole('button', { name: 'Добавить сотрудника', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Новый сотрудник' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Имя и фамилия')).toBeFocused();
  await dialog.getByLabel('Имя и фамилия').fill(name);
  await dialog.getByLabel(/^Должность/).fill('Разработчик');
  await dialog.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const state = await (await request.get('/api/state')).json();
  const employee = state.employees.find((item: { name: string }) => item.name === name);
  expect(employee).toBeTruthy();
  await expect(page.getByLabel('Сотрудник', { exact: true })).toHaveValue(employee.id);

  await page.getByLabel('Над чем работаете?').fill(task);
  await page.getByRole('button', { name: 'Начать', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Остановить', exact: true })).toBeVisible();
  await expect(page.getByLabel('Над чем работаете?')).toHaveValue(task);
  const repeated = await request.post('/api/timers/start', { data: { employeeId: employee.id, description: 'Повторный запуск' } });
  expect(repeated.status()).toBe(409);
  const running = await (await request.get('/api/state')).json();
  expect(running.entries.filter((entry: { employeeId: string; stoppedAt: string | null }) => entry.employeeId === employee.id && !entry.stoppedAt)).toHaveLength(1);

  await page.reload();
  await page.getByLabel('Сотрудник', { exact: true }).selectOption(employee.id);
  await expect(page.getByRole('button', { name: 'Остановить', exact: true })).toBeVisible();
  await expect(page.getByLabel('Над чем работаете?')).toHaveValue(task);
  await expect(page.getByLabel('Над чем работаете?')).toHaveAttribute('readonly', '');
  await expect.poll(async () => page.getByRole('timer').textContent()).not.toBe('00:00:00');
  await page.getByRole('button', { name: 'Остановить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Начать', exact: true })).toBeVisible();
  const stopped = await (await request.get('/api/state')).json();
  const savedEntry = stopped.entries.find((entry: { description: string }) => entry.description === task);
  expect(savedEntry.stoppedAt).toBeTruthy();

  // A second task exercises spreadsheet formula escaping in the CSV export.
  const formula = await request.post('/api/timers/start', { data: { employeeId: employee.id, description: '=SUM(1,2)' } });
  const formulaEntry = await formula.json();
  expect(formula.status()).toBe(201);
  expect((await request.post(`/api/timers/${formulaEntry.id}/stop`)).status()).toBe(200);

  await page.getByLabel('Сотрудник в отчёте').selectOption(employee.id);
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
  await expect(page.getByRole('cell', { name: task, exact: false })).toBeVisible();
  await expect(page.getByRole('cell', { name: '=SUM(1,2)', exact: false })).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать CSV', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toMatch(/^temp-entries-.*\.csv$/);
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const csv = await readFile(downloadPath!, 'utf8');
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain(task);
  expect(csv).toContain('"\'=SUM(1,2)"');

  await page.getByRole('button', { name: 'По сотрудникам', exact: true }).click();
  const summary = page.getByRole('region', { name: 'Итоги по сотрудникам' });
  await expect(summary.getByText(name, { exact: true })).toBeVisible();
  await expect(summary.getByRole('cell', { name: '2', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Записи', exact: true }).click();
  await page.getByLabel('Начало периода').fill('2099-01-01');
  await expect(page.getByRole('alert')).toContainText('Начало периода должно быть не позже');
  await page.getByLabel('Конец периода').fill('2099-01-02');
  await expect(page.getByRole('heading', { name: 'За этот период записей нет' })).toBeVisible();
  await page.getByRole('button', { name: 'По сотрудникам', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Итоги по сотрудникам' }).getByRole('cell', { name: '0 сек', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
  await page.getByRole('button', { name: 'Записи', exact: true }).click();
  await expect(page.getByRole('cell', { name: task, exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole('button', { name: 'Начать', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await page.getByText(task, { exact: true }).evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(80);
  await page.screenshot({ path: '/tmp/falcon-time-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Сотрудники', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
