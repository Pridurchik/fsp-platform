// Сквозной сценарий кейса через HTTP, как в браузере:
// регистрация → профиль → заявка → организатор видит участника → старт и финиш → результаты → публикация → рейтинг.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { startServer } from '../src/main.js';
import { get, all } from '../src/db/index.js';
import { SAMPLE_PASSWORD } from '../src/db/seed.js';

const dbFile = path.join(os.tmpdir(), `fsp-e2e-${process.pid}.sqlite`);
let server;
let base;

function client() {
  const jar = new Map();
  const store = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar.set(pair.slice(0, i), decodeURIComponent(pair.slice(i + 1)));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
  return {
    jar,
    async get(url) {
      const res = await fetch(base + url, { headers: { cookie: cookie() }, redirect: 'manual' });
      store(res);
      return { status: res.status, location: res.headers.get('location'), text: await res.text() };
    },
    async post(url, fields, { csrf = true } = {}) {
      if (!jar.has('fsp_csrf')) await this.get('/');
      const body = new URLSearchParams();
      if (csrf) body.append('_csrf', jar.get('fsp_csrf'));
      for (const [k, v] of Object.entries(fields)) {
        for (const item of [].concat(v)) body.append(k, String(item));
      }
      const res = await fetch(base + url, {
        method: 'POST',
        headers: { cookie: cookie(), 'content-type': 'application/x-www-form-urlencoded' },
        body,
        redirect: 'manual',
      });
      store(res);
      return { status: res.status, location: res.headers.get('location'), text: await res.text() };
    },
  };
}

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(dbFile + s, { force: true });
  server = await startServer({ port: 0, host: '127.0.0.1', dbFile, quiet: true, sample: true });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  for (const s of ['', '-wal', '-shm']) rmSync(dbFile + s, { force: true });
});

test('публичные страницы открываются', async () => {
  const guest = client();
  for (const url of ['/', '/competitions', '/competitions?tab=finished', '/rating', '/rating?d=ALGO', '/rating/method', '/calendar', '/news', '/documents', '/about', '/api/v1/rating']) {
    const r = await guest.get(url);
    assert.equal(r.status, 200, url);
  }
  assert.equal((await guest.get('/нет-такой-страницы')).status, 404);
});

test('защита: без токена формы не принимаются, спортсмен не попадает к организатору', async () => {
  const guest = client();
  await guest.get('/');
  assert.equal((await guest.post('/login', { email: 'x@y.ru', password: '1' }, { csrf: false })).status, 403);
  const athlete = client();
  const login = await athlete.post('/login', { email: 'athlete@example.com', password: SAMPLE_PASSWORD });
  assert.equal(login.status, 303);
  assert.equal((await athlete.get('/admin')).status, 403);
  const wrong = await client().post('/login', { email: 'athlete@example.com', password: 'неверный' });
  assert.equal(wrong.status, 400);
});

test('основной сценарий кейса от регистрации до пересчёта рейтинга', async () => {
  const cup = get("SELECT id FROM competitions WHERE title LIKE '%осенний этап%'");
  const event = get('SELECT id FROM competition_events WHERE competition_id = ?', cup.id);
  const municipality = get("SELECT id FROM municipalities WHERE name = 'Махачкала'");
  const organization = get("SELECT id FROM organizations WHERE name = 'Лицей № 7'");

  // 1. Спортсмен регистрируется
  const athlete = client();
  let r = await athlete.post('/register', {
    last_name: 'Тестов', first_name: 'Тимур', email: 'timur@example.ru', password: 'password123', consent: '1', next: `/competitions/${cup.id}`,
  });
  assert.equal(r.status, 303);
  assert.match(r.location, /^\/cabinet\/profile\?welcome=1/);
  const me = get("SELECT a.* FROM athletes a JOIN users u ON u.id = a.user_id WHERE u.email = 'timur@example.ru'");
  assert.ok(me, 'спортсмен создан');

  // Без профиля заявку подать нельзя: отправляем заполнять профиль
  r = await athlete.post(`/competitions/${cup.id}/apply`, { event_id: event.id });
  assert.match(r.location, /^\/cabinet\/profile/);

  // 2. Заполняет профиль
  r = await athlete.post('/cabinet/profile', {
    last_name: 'Тестов', first_name: 'Тимур', middle_name: '', birth_date: '2009-03-14',
    municipality_id: municipality.id, organization_id: organization.id, discipline_ids: [get("SELECT id FROM disciplines WHERE code = 'ALGO'").id],
    is_public: '1', next: `/competitions/${cup.id}`,
  });
  assert.equal(r.location, `/competitions/${cup.id}`);

  // 3. Подаёт заявку, она появляется в кабинете
  r = await athlete.post(`/competitions/${cup.id}/apply`, { event_id: event.id });
  assert.equal(r.status, 303);
  const cabinet = await athlete.get('/cabinet');
  assert.match(cabinet.text, /осенний этап/);
  assert.match(cabinet.text, /Заявка подана/);
  // Повторная заявка в ту же дисциплину не проходит
  r = await athlete.post(`/competitions/${cup.id}/apply`, { event_id: event.id });
  assert.equal(get('SELECT COUNT(*) AS n FROM registrations WHERE athlete_id = ?', me.id).n, 1);

  // 4. Организатор видит участника
  const org = client();
  r = await org.post('/login', { email: 'organizer@example.com', password: SAMPLE_PASSWORD });
  assert.equal(r.location, '/admin');
  const participants = await org.get(`/admin/competitions/${cup.id}/participants`);
  assert.match(participants.text, /Тестов Тимур/);

  // До завершения результаты не вносятся
  r = await org.post(`/admin/events/${event.id}/results`, { action: 'save' });
  assert.equal(get('SELECT status FROM competitions WHERE id = ?', cup.id).status, 'PUBLISHED');

  // 5. Старт и финиш
  await org.post(`/admin/competitions/${cup.id}/transition`, { action: 'start' });
  await org.post(`/admin/competitions/${cup.id}/transition`, { action: 'finish' });
  assert.equal(get('SELECT status FROM competitions WHERE id = ?', cup.id).status, 'FINISHED');

  // 6. Вносит баллы и расставляет места
  const rows = all('SELECT athlete_id, score FROM results WHERE event_id = ?', event.id);
  const fields = { action: 'autoplace', athlete_ids: [...rows.map((x) => x.athlete_id), me.id], participants_total: '' };
  for (const x of rows) fields[`score_${x.athlete_id}`] = x.score;
  fields[`score_${me.id}`] = 9999;
  r = await org.post(`/admin/events/${event.id}/results`, fields);
  assert.equal(r.status, 303);
  assert.equal(get('SELECT place FROM results WHERE event_id = ? AND athlete_id = ?', event.id, me.id).place, 1);
  assert.equal(get('SELECT COUNT(*) AS n FROM results WHERE event_id = ? AND place IS NOT NULL', event.id).n, 20);

  // 7. Публикует итоги
  r = await org.post(`/admin/competitions/${cup.id}/transition`, { action: 'publishResults' });
  assert.equal(r.status, 303);
  assert.equal(get('SELECT status FROM competitions WHERE id = ?', cup.id).status, 'RESULTS_PUBLISHED');

  // 8. Результат в профиле и кабинете, рейтинг пересчитан: 300 × 1 × 0,906 × 1 = 271,9
  const api = await athlete.get(`/api/v1/athletes/${me.id}`);
  const profile = JSON.parse(api.text);
  assert.equal(profile.rating, 271.9);
  assert.equal(profile.counted.length, 1);
  const after = await athlete.get('/cabinet');
  assert.match(after.text, /271,9/);
  assert.match(after.text, /Итоги:/);
  const card = await client().get(`/competitions/${cup.id}`);
  assert.match(card.text, /Итоги/);
  assert.match(card.text, /Тестов Тимур/);
  const change = get('SELECT * FROM rating_changes WHERE athlete_id = ? AND competition_id = ?', me.id, cup.id);
  assert.equal(Math.round(change.rating_after * 10) / 10, 271.9);
});

test('разряд влияет на рейтинг только после подтверждения', async () => {
  const novice = client();
  await novice.post('/login', { email: 'novice@example.com', password: SAMPLE_PASSWORD });
  const athleteId = get("SELECT a.id FROM athletes a JOIN users u ON u.id = a.user_id WHERE u.email = 'novice@example.com'").id;
  const before = JSON.parse((await client().get(`/api/v1/athletes/${athleteId}`)).text).rating;
  const pending = get("SELECT id FROM athlete_ranks WHERE athlete_id = ? AND status = 'PENDING'", athleteId);
  assert.ok(pending, 'в примере наполнения есть заявка на разряд');

  const org = client();
  await org.post('/login', { email: 'organizer@example.com', password: SAMPLE_PASSWORD });
  await org.post(`/admin/athlete-ranks/${pending.id}/review`, { status: 'CONFIRMED', back: '/admin' });
  const after = JSON.parse((await client().get(`/api/v1/athletes/${athleteId}`)).text).rating;
  // II юношеский (+15) сменился на III разряд (+30)
  assert.equal(Math.round((after - before) * 10) / 10, 15);
});

test('веса из справочника сразу меняют рейтинг', async () => {
  const org = client();
  await org.post('/login', { email: 'organizer@example.com', password: SAMPLE_PASSWORD });
  const hero = get("SELECT a.id FROM athletes a JOIN users u ON u.id = a.user_id WHERE u.email = 'athlete@example.com'").id;
  const before = JSON.parse((await client().get(`/api/v1/athletes/${hero}`)).text).rating;
  const kms = get("SELECT id FROM ranks WHERE code = 'KMS'");
  const fields = {};
  for (const r of all('SELECT * FROM ranks')) {
    fields[`name_${r.id}`] = r.name;
    fields[`short_${r.id}`] = r.short_name;
    fields[`bonus_${r.id}`] = r.id === kms.id ? 200 : r.bonus_points;
  }
  await org.post('/admin/dictionaries/ranks', fields);
  const after = JSON.parse((await client().get(`/api/v1/athletes/${hero}`)).text).rating;
  assert.equal(Math.round((after - before) * 10) / 10, 40);
});
