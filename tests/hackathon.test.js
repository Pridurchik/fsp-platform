// Хакатон через API мобильного приложения: регистрация → заявка → допуск организатором → чат участников →
// пункты расписания приходят уведомлениями, только пока соревнование идёт → отказ убирает из чата.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { startServer } from '../src/main.js';
import { get, run } from '../src/db/index.js';
import { hashPassword } from '../src/core/auth.js';
import { todayISO, addDays } from '../src/core/dates.js';
import { createCompetition, applyTransition } from '../src/modules/competitions.js';
import { addOrganization } from '../src/modules/dictionaries.js';
import { dispatchDueItems, localStamp } from '../src/modules/schedule.js';

const dbFile = path.join(os.tmpdir(), `fsp-hackathon-${process.pid}.sqlite`);
let server;
let base;

async function api(method, url, { token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}/api/mobile${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json() };
}

before(async () => {
  for (const s of ['', '-wal', '-shm']) rmSync(dbFile + s, { force: true });
  server = await startServer({ port: 0, host: '127.0.0.1', dbFile, quiet: true });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  for (const s of ['', '-wal', '-shm']) rmSync(dbFile + s, { force: true });
});

test('хакатон: допуск добавляет в чат, расписание приходит уведомлениями во время соревнования', async () => {
  const today = todayISO();
  run('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', 'org@test.ru', hashPassword('organizer-pass'), 'ORGANIZER');
  const municipality = get("SELECT id FROM municipalities WHERE name = 'Махачкала'").id;
  addOrganization('Лицей № 39', 'SCHOOL', municipality);
  const organization = get("SELECT id FROM organizations WHERE name = 'Лицей № 39'").id;
  const product = get("SELECT id FROM disciplines WHERE code = 'PRODUCT'").id;
  const level = get("SELECT id FROM competition_levels WHERE code = 'REGIONAL'").id;
  const orgUser = get("SELECT id FROM users WHERE email = 'org@test.ru'").id;
  const id = createCompetition({
    title: 'Хакатон проверки чата', level_id: level, format: 'OFFLINE', city: 'Махачкала', venue: null, description: '',
    start_date: today, end_date: addDays(today, 1), reg_start: addDays(today, -1), reg_end: today, regulations_url: null,
    is_external: 0, disciplineIds: [product],
  }, orgUser);
  applyTransition(id, 'publish', orgUser);

  // Без токена API закрыт, cookie сайта здесь не принимаются
  assert.equal((await api('GET', '/me')).status, 401);
  assert.equal((await api('GET', '/me', { token: 'bogus' })).status, 401);

  // 1. Спортсмен регистрируется в приложении и заполняет профиль
  let r = await api('POST', '/register', { body: { lastName: 'Т', firstName: 'Ани', email: 'bad', password: '1', consent: false } });
  assert.equal(r.status, 400);
  assert.ok(r.data.fields.lastName && r.data.fields.email && r.data.fields.password && r.data.fields.consent);
  r = await api('POST', '/register', {
    body: { lastName: 'Тагирова', firstName: 'Аминат', email: 'aminat@test.ru', password: 'secret-123', consent: true },
  });
  assert.equal(r.status, 201);
  const athlete = r.data.token;
  assert.equal(r.data.me.athlete.profileComplete, false);
  r = await api('GET', `/competitions/${id}`, { token: athlete });
  assert.equal(r.data.apply.state, 'profile');
  r = await api('POST', '/profile', {
    token: athlete,
    body: { lastName: 'Тагирова', firstName: 'Аминат', municipalityId: municipality, organizationId: organization, disciplineIds: [product], isPublic: true },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.me.athlete.profileComplete, true);

  // 2. Заявка подана: чата пока нет
  r = await api('GET', `/competitions/${id}`, { token: athlete });
  assert.equal(r.data.apply.state, 'open');
  assert.equal(r.data.isHackathon, true);
  r = await api('POST', `/competitions/${id}/apply`, { token: athlete, body: { eventId: r.data.apply.events[0].id } });
  assert.equal(r.status, 200);
  r = await api('GET', `/competitions/${id}`, { token: athlete });
  assert.equal(r.data.myRegistrations[0].status, 'SUBMITTED');
  assert.equal(r.data.chat.available, false);
  assert.match(r.data.chat.hint, /на рассмотрении/);
  assert.equal((await api('GET', `/chats/${id}`, { token: athlete })).status, 403);
  assert.equal((await api('GET', '/chats', { token: athlete })).data.items.length, 0);

  // 3. Организатор в приложении видит заявку и допускает её
  r = await api('POST', '/login', { body: { email: 'org@test.ru', password: 'organizer-pass' } });
  const org = r.data.token;
  assert.equal(r.data.me.isOrganizer, true);
  assert.equal((await api('GET', '/admin/overview', { token: athlete })).status, 403);
  r = await api('GET', '/admin/overview', { token: org });
  assert.equal(r.data.pendingTotal, 1);
  r = await api('GET', `/admin/competitions/${id}/registrations`, { token: org });
  const registration = r.data.items[0];
  assert.equal(registration.status, 'SUBMITTED');
  r = await api('POST', `/admin/registrations/${registration.id}/status`, { token: org, body: { status: 'APPROVED' } });
  assert.equal(r.data.chat, 'joined');

  // 4. Спортсмен в чате: уведомление ведёт в чат, в чате сообщение о новом участнике
  r = await api('GET', '/notifications', { token: athlete });
  assert.match(r.data.items[0].title, /Заявка одобрена: Хакатон проверки чата/);
  assert.deepEqual(r.data.items[0].target, { type: 'chat', competitionId: id });
  assert.equal(r.data.unreadChats, 1);
  r = await api('GET', '/chats', { token: athlete });
  assert.equal(r.data.items.length, 1);
  assert.equal(r.data.items[0].members, 1);
  r = await api('GET', `/chats/${id}`, { token: athlete });
  assert.equal(r.status, 200);
  assert.equal(r.data.messages.at(-1).author.kind, 'system');
  assert.match(r.data.messages.at(-1).body, /Новый участник: Аминат Тагирова/);
  assert.equal((await api('GET', '/chats', { token: athlete })).data.items[0].unread, 0);

  // 5. Переписка: сообщение организатора приходит участникам уведомлением
  r = await api('POST', `/chats/${id}/messages`, { token: athlete, body: { body: '   ' } });
  assert.equal(r.status, 400);
  r = await api('POST', `/chats/${id}/messages`, { token: athlete, body: { body: 'Здравствуйте! Мы готовы.' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.message.mine, true);
  const lastId = r.data.message.id;
  r = await api('POST', `/chats/${id}/messages`, { token: org, body: { body: 'Регистрация команд в 9:30 у входа.' } });
  assert.equal(r.data.message.author.kind, 'organizer');
  r = await api('GET', `/chats/${id}/messages?after=${lastId}`, { token: athlete });
  assert.equal(r.data.items.length, 1);
  assert.equal(r.data.items[0].mine, false);
  assert.match((await api('GET', '/notifications', { token: athlete })).data.items[0].title, /Организатор в чате/);

  // Живой поток: сообщение и уведомление приходят в приложение сразу, без опроса
  const stream = await openEvents(athlete);
  assert.equal(typeof (await stream.next('ready')).unread, 'number');
  await api('POST', `/chats/${id}/messages`, { token: org, body: { body: 'Живое объявление' } });
  assert.equal((await stream.next('message')).message.body, 'Живое объявление');
  assert.match((await stream.next('notification')).notification.title, /Организатор в чате/);
  stream.close();

  // 6. Пункты расписания: пока хакатон не начался, уведомлений нет
  const now = new Date();
  const minutesAgo = (m) => localStamp(new Date(now.getTime() - m * 60_000));
  const input = (stamp, kind, title) => ({ kind, title, date: stamp.slice(0, 10), time: stamp.slice(11, 16) });
  r = await api('POST', `/admin/competitions/${id}/schedule`, { token: org, body: input(minutesAgo(1), 'CHECKPOINT', 'Демо MVP') });
  assert.equal(r.status, 201);
  const checkpoint = r.data.item.id;
  await api('POST', `/admin/competitions/${id}/schedule`, { token: org, body: input(minutesAgo(40), 'COFFEE_BREAK', 'Кофе-брейк') });
  assert.equal((await api('POST', `/admin/competitions/${id}/schedule`, { token: org, body: { kind: 'X', title: '', date: '', time: '25:00' } })).status, 400);
  assert.equal(dispatchDueItems(now), 0);
  r = await api('GET', '/schedule/upcoming', { token: athlete });
  assert.equal(r.data.items.length, 0);

  // 7. Хакатон начался: уведомление о начавшемся пункте уходит один раз, давно прошедший пункт не рассылается
  applyTransition(id, 'start', orgUser);
  assert.match((await api('GET', '/notifications', { token: athlete })).data.items[0].title, /Соревнование началось: Хакатон проверки чата/);
  assert.equal(dispatchDueItems(now), 1);
  assert.equal(dispatchDueItems(now), 0);
  r = await api('GET', '/notifications', { token: athlete });
  assert.equal(r.data.items[0].title, 'Начинается чекпоинт: Демо MVP');
  assert.deepEqual(r.data.items[0].target, { type: 'schedule', competitionId: id, itemId: checkpoint });
  assert.ok(!r.data.items.some((n) => /Кофе-брейк/.test(n.title)));
  r = await api('GET', `/chats/${id}/messages?after=${lastId}`, { token: athlete });
  assert.equal(r.data.items.at(-1).body, 'Начинается чекпоинт: Демо MVP');
  r = await api('GET', `/competitions/${id}/schedule`);
  assert.equal(r.data.items.find((s) => s.id === checkpoint).notified, true);

  // Будущий пункт виден приложению: по нему ставится напоминание на телефоне
  const later = localStamp(new Date(now.getTime() + 90 * 60_000));
  await api('POST', `/admin/competitions/${id}/schedule`, { token: org, body: input(later, 'PITCH', 'Защита проектов') });
  r = await api('GET', '/schedule/upcoming', { token: athlete });
  assert.equal(r.data.items.length, 1);
  assert.equal(r.data.items[0].notificationTitle, 'Начинается: Защита проектов');

  // 8. Страница соревнования на сайте показывает расписание
  const page = await (await fetch(`${base}/competitions/${id}`)).text();
  assert.match(page, /id="schedule"/);
  assert.match(page, /Демо MVP/);

  // 9. Отказ убирает спортсмена из чата и присылает уведомление
  r = await api('POST', `/admin/registrations/${registration.id}/status`, { token: org, body: { status: 'REJECTED' } });
  assert.equal(r.data.chat, 'left');
  assert.equal((await api('GET', `/chats/${id}`, { token: athlete })).status, 403);
  assert.equal((await api('GET', '/chats', { token: athlete })).data.items.length, 0);
  assert.match((await api('GET', '/notifications', { token: athlete })).data.items[0].title, /Заявка отклонена/);
  assert.equal((await api('GET', '/schedule/upcoming', { token: athlete })).data.items.length, 0);

  // 10. Организатор завершает хакатон из приложения; спортсмену это действие недоступно
  assert.equal((await api('POST', `/admin/competitions/${id}/transition`, { token: athlete, body: { action: 'finish' } })).status, 403);
  assert.equal((await api('POST', `/admin/competitions/${id}/transition`, { token: org, body: { action: 'publishResults' } })).status, 400);
  r = await api('POST', `/admin/competitions/${id}/transition`, { token: org, body: { action: 'finish' } });
  assert.equal(r.data.status, 'FINISHED');
  r = await api('GET', `/chats/${id}`, { token: org });
  assert.match(r.data.messages.at(-1).body, /Соревнование завершено/);
});

test('вход в приложение защищён от перебора пароля', async () => {
  run('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', 'brute@test.ru', hashPassword('right-password'), 'ATHLETE');
  for (let i = 0; i < 10; i++) {
    assert.equal((await api('POST', '/login', { body: { email: 'brute@test.ru', password: `wrong-${i}` } })).status, 400);
  }
  const r = await api('POST', '/login', { body: { email: 'brute@test.ru', password: 'right-password' } });
  assert.equal(r.status, 429);
  assert.equal((await api('GET', '/health')).data.ok, true);
});

// Поток событий /api/mobile/events: читаем его как приложение.
async function openEvents(token) {
  const controller = new AbortController();
  const res = await fetch(`${base}/api/mobile/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    async next(name) {
      for (;;) {
        const end = buffer.indexOf('\n\n');
        if (end >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (/^event: (\S+)/m.exec(chunk)?.[1] === name) return JSON.parse(/^data: (.*)$/m.exec(chunk)[1]);
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('Поток закрыт');
        buffer += decoder.decode(value, { stream: true });
      }
    },
    close: () => controller.abort(),
  };
}
