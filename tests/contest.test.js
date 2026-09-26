// Кейс №2, модуль проведения соревнований. Сценарий защиты целиком через HTTP:
// организатор создаёт контест → добавляет задания → публикует → спортсмен открывает контест → отправляет решение →
// организатор проверяет → появляются результаты → результат в профиле и в рейтинге.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { startServer } from '../src/main.js';
import { get, run } from '../src/db/index.js';
import { todayISO, addDays } from '../src/core/dates.js';
import { SAMPLE_PASSWORD } from '../src/db/seed.js';
import { standings, syncContestStatus } from '../src/modules/contests.js';
import { getCompetition } from '../src/modules/competitions.js';

const dbFile = path.join(os.tmpdir(), `fsp-contest-${process.pid}.sqlite`);
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
    return { status: res.status, location: res.headers.get('location'), text: await res.text() };
  }
  return {
    get: (url) => send(url, { method: 'GET', headers: {} }),
    async post(url, fields) {
      if (!jar.has('fsp_csrf')) await this.get('/');
      const body = new URLSearchParams({ _csrf: jar.get('fsp_csrf') });
      for (const [k, v] of Object.entries(fields)) for (const item of [].concat(v)) body.append(k, String(item));
      return send(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    },
  };
}

const status = (id) => get('SELECT status FROM competitions WHERE id = ?', id).status;
const submissionsOf = (athleteId) => get('SELECT COUNT(*) AS n FROM submissions WHERE athlete_id = ?', athleteId).n;

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(dbFile + s, { force: true });
  server = await startServer({ port: 0, host: '127.0.0.1', dbFile, quiet: true, sample: true });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  for (const s of ['', '-wal', '-shm']) rmSync(dbFile + s, { force: true });
});

test('кейс №2: контест от создания до результата в профиле и рейтинге', async () => {
  const today = todayISO();
  const algo = get("SELECT id FROM disciplines WHERE code = 'ALGO'").id;
  const product = get("SELECT id FROM disciplines WHERE code = 'PRODUCT'").id;
  const level = get("SELECT id FROM competition_levels WHERE code = 'REGIONAL'").id;
  const novice = get("SELECT a.id FROM athletes a JOIN users u ON u.id = a.user_id WHERE u.email = 'novice@example.com'").id;
  const form = {
    title: 'Контест финала: проверка модуля', level_id: level, format: 'ONLINE', discipline_ids: [algo], start_date: today, end_date: today,
    reg_start: '', reg_end: '', city: '', venue: '', description: 'Проверочный контест', regulations_url: '',
    on_platform: '1', start_time: '10:00', end_time: '14:00', rules: 'Ответ текстом или ссылкой на код.', external_platform: '', external_url: '',
  };

  // 1. Организатор создаёт контест. Контест проводится по одной дисциплине
  const org = client();
  await org.post('/login', { email: 'organizer@example.com', password: SAMPLE_PASSWORD });
  assert.equal((await org.post('/admin/competitions', { ...form, discipline_ids: [algo, product] })).status, 400);
  let r = await org.post('/admin/competitions', form);
  assert.equal(r.status, 303);
  const id = Number(r.location.match(/\/admin\/competitions\/(\d+)\/tasks/)[1]);
  assert.equal(status(id), 'DRAFT');
  assert.equal(get('SELECT on_platform FROM contests WHERE competition_id = ?', id).on_platform, 1);

  // 2. Добавляет три задания
  for (const [title, statement] of [['Сумма на отрезке', 'Найдите сумму на отрезке массива.'], ['Маршрут', 'Найдите кратчайший путь в графе.'], ['Кружки', 'Выберите максимум непересекающихся занятий.']]) {
    r = await org.post(`/admin/competitions/${id}/tasks`, { title, statement, max_score: 100, materials_url: '' });
    assert.equal(r.status, 303);
  }
  assert.equal((await org.post(`/admin/competitions/${id}/tasks`, { title: 'Без баллов', statement: 'Условие без максимума баллов.', max_score: 0, materials_url: '' })).status, 400);
  const [taskA, taskB, taskC] = [1, 2, 3].map((p) => get('SELECT id FROM contest_tasks WHERE competition_id = ? AND position = ?', id, p).id);

  // 3. Публикует: открывается регистрация, задания пока скрыты
  await org.post(`/admin/competitions/${id}/transition`, { action: 'publish' });
  assert.equal(status(id), 'PUBLISHED');
  const athlete = client();
  await athlete.post('/login', { email: 'novice@example.com', password: SAMPLE_PASSWORD });
  let page = await athlete.get(`/competitions/${id}`);
  assert.doesNotMatch(page.text, /Найдите сумму на отрезке/);
  assert.match(page.text, /Задания откроются в момент старта/);

  // 4. Спортсмен подаёт заявку. До старта решения не принимаются
  const event = get('SELECT id FROM competition_events WHERE competition_id = ?', id).id;
  await athlete.post(`/competitions/${id}/apply`, { event_id: event });
  assert.ok(get("SELECT id FROM registrations WHERE event_id = ? AND athlete_id = ? AND status = 'SUBMITTED'", event, novice));
  const before = submissionsOf(novice);
  await athlete.post(`/tasks/${taskA}/submit`, { answer_text: 'Рано', answer_url: '' });
  assert.equal(submissionsOf(novice), before);

  // 5. Старт: спортсмен открывает контест и видит задания
  await org.post(`/admin/competitions/${id}/transition`, { action: 'start' });
  assert.equal(status(id), 'ONGOING');
  page = await athlete.get(`/competitions/${id}`);
  assert.match(page.text, /Найдите сумму на отрезке/);
  assert.match(page.text, /Отправить решение/);

  // 6. Отправляет решения: текстом и ссылкой. Пустые ответы и опасные ссылки не сохраняются
  r = await athlete.post(`/tasks/${taskA}/submit`, { answer_text: 'Префиксные суммы, O(n + q).', answer_url: '' });
  assert.equal(r.status, 303);
  await athlete.post(`/tasks/${taskB}/submit`, { answer_text: '', answer_url: 'https://example.com/bfs.py' });
  await athlete.post(`/tasks/${taskC}/submit`, { answer_text: '', answer_url: '' });
  await athlete.post(`/tasks/${taskC}/submit`, { answer_text: '', answer_url: 'javascript:alert(1)' });
  assert.equal(submissionsOf(novice) - before, 2);

  // 7. Организатор видит решения и выставляет баллы. Оценка выше максимума не принимается
  const subs = await org.get(`/admin/competitions/${id}/submissions`);
  assert.match(subs.text, /Префиксные суммы/);
  const sA = get('SELECT id FROM submissions WHERE task_id = ? AND athlete_id = ?', taskA, novice).id;
  const sB = get('SELECT id FROM submissions WHERE task_id = ? AND athlete_id = ?', taskB, novice).id;
  await org.post(`/admin/submissions/${sA}/grade`, { score: 150, comment: '' });
  assert.equal(get('SELECT score FROM submissions WHERE id = ?', sA).score, null);
  await org.post(`/admin/submissions/${sA}/grade`, { score: 90, comment: 'Верно' });
  await org.post(`/admin/submissions/${sB}/grade`, { score: 70, comment: '' });
  assert.equal(get('SELECT score FROM submissions WHERE id = ?', sA).score, 90);

  // 8. Ещё одно решение, завершение. С непроверенным решением итоги не публикуются
  await athlete.post(`/tasks/${taskC}/submit`, { answer_text: 'Жадно по времени окончания.', answer_url: '' });
  await org.post(`/admin/competitions/${id}/transition`, { action: 'finish' });
  assert.equal(status(id), 'FINISHED');
  const late = submissionsOf(novice);
  await athlete.post(`/tasks/${taskA}/submit`, { answer_text: 'Поздно', answer_url: '' });
  assert.equal(submissionsOf(novice), late, 'после завершения решения не принимаются');
  await org.post(`/admin/competitions/${id}/transition`, { action: 'publishResults' });
  assert.equal(status(id), 'FINISHED');
  const sC = get('SELECT id FROM submissions WHERE task_id = ? AND athlete_id = ?', taskC, novice).id;
  await org.post(`/admin/submissions/${sC}/grade`, { score: 40, comment: '' });

  // 9. Публикация: итоговая таблица, результат в профиле, рейтинг пересчитан
  r = await org.post(`/admin/competitions/${id}/transition`, { action: 'publishResults' });
  assert.equal(r.status, 303);
  assert.equal(status(id), 'RESULTS_PUBLISHED');
  const result = get('SELECT r.place, r.score FROM results r WHERE r.event_id = ? AND r.athlete_id = ?', event, novice);
  assert.deepEqual({ ...result }, { place: 1, score: 200 });
  page = await client().get(`/competitions/${id}`);
  assert.match(page.text, /Итоговая таблица/);
  assert.match(page.text, /Юсупова Сабина/);
  const profile = await client().get(`/athletes/${novice}`);
  assert.match(profile.text, /Контест финала: проверка модуля/);
  assert.ok(get('SELECT id FROM rating_changes WHERE athlete_id = ? AND competition_id = ?', novice, id), 'рейтинг пересчитан');
  const apiProfile = JSON.parse((await client().get(`/api/v1/athletes/${novice}`)).text);
  assert.ok(apiProfile.counted.some((line) => line.competitionId === id), 'контест в зачёте рейтинга');
  const notes = (await athlete.get('/cabinet')).text;
  assert.match(notes, /Решение проверено/);
  assert.match(notes, /Итоги: Контест финала/);
});

test('таблица: при равной сумме выше тот, кто раньше набрал её, при полном совпадении место делится', () => {
  const demo = get("SELECT id FROM competitions WHERE title = 'Тестовый контест по алгоритмическому программированию'").id;
  const { tasks, rows } = standings(demo);
  assert.equal(tasks.length, 3);
  assert.deepEqual(rows.map((r) => r.total), [280, 190, 170, 170, 60, 0]);
  assert.deepEqual(rows.map((r) => r.place), [1, 2, 3, 4, 5, 6]);
  assert.ok(rows[2].reachedAt < rows[3].reachedAt, 'ничья по сумме решена временем');

  // Полное совпадение суммы и времени: место делится
  const [third, fourth] = [rows[2], rows[3]];
  run('UPDATE submissions SET created_at = ? WHERE athlete_id = ? AND score > 0 AND task_id IN (SELECT id FROM contest_tasks WHERE competition_id = ?) AND created_at = ?', third.reachedAt, fourth.athleteId, demo, fourth.reachedAt);
  const tied = standings(demo).rows;
  assert.deepEqual(tied.map((r) => r.place), [1, 2, 3, 3, 5, 6]);
});

test('статус контеста может меняться автоматически по времени', () => {
  const today = todayISO();
  const level = get("SELECT id FROM competition_levels WHERE code = 'REGIONAL'").id;
  const id = run("INSERT INTO competitions (title, level_id, format, status, start_date, end_date) VALUES ('Автоконтест', ?, 'ONLINE', 'PUBLISHED', ?, ?)", level, addDays(today, -1), today).id;
  run("INSERT INTO competition_events (competition_id, discipline_id) VALUES (?, (SELECT id FROM disciplines WHERE code = 'ALGO'))", id);
  run("INSERT INTO contests (competition_id, on_platform, start_time, end_time, auto_status) VALUES (?, 1, '00:00', '23:59', 1)", id);
  assert.equal(syncContestStatus(getCompetition(id)).status, 'ONGOING');
  run('UPDATE competitions SET end_date = ? WHERE id = ?', addDays(today, -1), id);
  assert.equal(syncContestStatus(getCompetition(id)).status, 'FINISHED');
});
