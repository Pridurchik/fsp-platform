// Новый код контеста: протокол CSV и печатная версия, фильтр по заданию,
// «Мои контесты» в кабинете, статистика по заданиям, API таблицы.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { startServer } from '../src/main.js';
import { get } from '../src/db/index.js';
import { SAMPLE_PASSWORD } from '../src/db/seed.js';
import { athleteContests, taskStats, listSubmissions } from '../src/modules/contests.js';
import { notify } from '../src/modules/notifications.js';

const dbFile = path.join(os.tmpdir(), `fsp-protocol-${process.pid}.sqlite`);
let server;
let base;

function client() {
  const jar = new Map();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
  async function send(url, init) {
    const res = await fetch(base + url, { ...init, headers: { ...init.headers, cookie: cookie() }, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), decodeURIComponent(pair.slice(i + 1)));
    }
    return { status: res.status, location: res.headers.get('location'), text: await res.text(), headers: res.headers };
  }
  return {
    jar,
    get: (url) => send(url, { method: 'GET', headers: {} }),
    async post(url, fields) {
      if (!jar.has('fsp_csrf')) await this.get('/');
      const body = new URLSearchParams({ _csrf: jar.get('fsp_csrf') });
      for (const [k, v] of Object.entries(fields)) for (const item of [].concat(v)) body.append(k, String(item));
      return send(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    },
  };
}

test('веб SSE: авторизация, ready и персональное уведомление', async () => {
  const user = client();
  await user.post('/login', { email: 'novice@example.com', password: SAMPLE_PASSWORD });
  const response = await fetch(base + '/api/events', { headers: { cookie: [...user.jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') } });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: ready/);
  const athlete = get("SELECT a.id FROM athletes a JOIN users u ON u.id = a.user_id WHERE u.email = 'novice@example.com'").id;
  const userId = get('SELECT user_id FROM athletes WHERE id = ?', athlete).user_id;
  notify(userId, 'Тестовое уведомление', 'Проверка SSE', '/cabinet');
  const second = new TextDecoder().decode((await reader.read()).value);
  assert.match(second, /event: notification/);
  assert.match(second, /Тестовое уведомление/);
  reader.cancel();
});

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(dbFile + s, { force: true });
  server = await startServer({ port: 0, host: '127.0.0.1', dbFile, quiet: true, sample: true });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  for (const s of ['', '-wal', '-shm']) rmSync(dbFile + s, { force: true });
});

test('протокол CSV: только организатор, шапка и строки таблицы', async () => {
  const demo = get("SELECT id FROM competitions WHERE title = 'Тестовый контест по алгоритмическому программированию'").id;
  const anon = await client().get(`/admin/competitions/${demo}/protocol.csv`);
  assert.equal(anon.status, 303);

  const org = client();
  await org.post('/login', { email: 'organizer@example.com', password: SAMPLE_PASSWORD });
  const r = await org.get(`/admin/competitions/${demo}/protocol.csv`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.text, /Место;Фамилия;Имя;Отчество;Организация/);
  assert.match(r.text, /Гасанов/);
  assert.match(r.text, /Сумма/);
});

test('печатная версия: видна участникам завершённого контеста, черновик скрыт', async () => {
  const demo = get("SELECT id FROM competitions WHERE title = 'Тестовый контест по алгоритмическому программированию'").id;
  const page = await client().get(`/competitions/${demo}/protocol`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Протокол/);
  assert.match(page.text, /Главный судья/);

  const draft = get("SELECT id FROM competitions WHERE title = 'Открытый турнир по программированию робототехники'").id;
  const hidden = await client().get(`/competitions/${draft}/protocol`);
  assert.equal(hidden.status, 404);
});

test('фильтр решений по заданию: ?task= оставляет только его', async () => {
  const demo = get("SELECT id FROM competitions WHERE title = 'Тестовый контест по алгоритмическому программированию'").id;
  const tA = get('SELECT id FROM contest_tasks WHERE competition_id = ? AND position = 1', demo).id;
  const tB = get('SELECT id FROM contest_tasks WHERE competition_id = ? AND position = 2', demo).id;
  const org = client();
  await org.post('/login', { email: 'organizer@example.com', password: SAMPLE_PASSWORD });
  const filtered = await org.get(`/admin/competitions/${demo}/submissions?show=all&task=${tA}`);
  assert.equal(filtered.status, 200);
  // В списке — только решения по задаче A (текст решения), вкладки при этом показывают все задания
  assert.match(filtered.text, /Префиксные суммы/);
  assert.doesNotMatch(filtered.text, /Поиск в ширину/);
  // Модуль: тот же фильтр на уровне данных
  const rows = listSubmissions(demo, { taskId: tB });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((s) => s.task_id === tB));
});

test('кабинет: блок «Мои контесты и решения» и статистика заданий', async () => {
  const hero = get("SELECT a.id FROM athletes a JOIN users u ON u.id = a.user_id WHERE u.email = 'athlete@example.com'").id;
  const items = athleteContests(hero);
  assert.ok(items.length >= 1);
  assert.ok(items[0].submitted > 0);

  const demo = get("SELECT id FROM competitions WHERE title = 'Тестовый контест по алгоритмическому программированию'").id;
  const stats = taskStats(demo);
  assert.equal(stats.length, 3);
  assert.ok(stats.every((s) => s.total > 0 && s.max_score === 100));

  const athlete = client();
  await athlete.post('/login', { email: 'athlete@example.com', password: SAMPLE_PASSWORD });
  const cabinet = await athlete.get('/cabinet');
  assert.match(cabinet.text, /Мои контесты и решения/);
  assert.match(cabinet.text, /Тестовый контест/);

  const org = client();
  await org.post('/login', { email: 'organizer@example.com', password: SAMPLE_PASSWORD });
  const subs = await org.get(`/admin/competitions/${demo}/submissions`);
  assert.match(subs.text, /По заданиям/);
  assert.match(subs.text, /Скачать протокол CSV/);
  const publicPage = await client().get(`/competitions/${demo}`);
  assert.match(publicPage.text, /Время сервера/);
});

test('API таблицы: JSON для контеста, 404 для обычного и черновика', async () => {
  const demo = get("SELECT id FROM competitions WHERE title = 'Тестовый контест по алгоритмическому программированию'").id;
  const ok = JSON.parse((await client().get(`/api/v1/competitions/${demo}/standings`)).text);
  assert.equal(ok.competitionId, demo);
  assert.equal(ok.tasks.length, 3);
  assert.ok(ok.rows.length >= 6);
  assert.ok(ok.rows[0].total >= ok.rows[1].total);

  const plain = get("SELECT id FROM competitions WHERE title LIKE 'Кубок Республики Дагестан по алгоритмическому%'").id;
  assert.equal((await client().get(`/api/v1/competitions/${plain}/standings`)).status, 404);
  const draft = get("SELECT id FROM competitions WHERE title = 'Открытый турнир по программированию робототехники'").id;
  assert.equal((await client().get(`/api/v1/competitions/${draft}/standings`)).status, 404);

  const index = JSON.parse((await client().get('/api/v1')).text);
  assert.ok(index.endpoints['GET /api/v1/competitions/:id/standings']);
  const spec = JSON.parse((await client().get('/api/openapi.json')).text);
  assert.ok(spec.paths['/api/v1/competitions/{id}/standings']);
});
