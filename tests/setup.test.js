// Первый запуск на чистой базе: справочники есть, организатор создаётся по одноразовой ссылке.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { rmSync } from 'node:fs';
import { startServer } from '../src/main.js';
import { get } from '../src/db/index.js';
import { setupToken } from '../src/core/setup.js';

const dbFile = path.join(os.tmpdir(), `fsp-setup-${process.pid}.sqlite`);
let server;
let base;
const jar = new Map();

async function request(url, form) {
  const headers = { cookie: [...jar].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ') };
  let body;
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams({ _csrf: jar.get('fsp_csrf'), ...form });
  }
  const res = await fetch(base + url, { method: form ? 'POST' : 'GET', headers, body, redirect: 'manual' });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), decodeURIComponent(pair.slice(i + 1)));
  }
  return { status: res.status, location: res.headers.get('location'), text: await res.text() };
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

test('чистая база: справочники загружены, примеров нет, страницы открываются', async () => {
  assert.equal(get('SELECT COUNT(*) AS n FROM disciplines').n, 5);
  assert.ok(get('SELECT COUNT(*) AS n FROM municipalities').n >= 50, 'все муниципалитеты Дагестана');
  assert.equal(get('SELECT COUNT(*) AS n FROM athletes').n, 0);
  assert.equal(get('SELECT COUNT(*) AS n FROM users').n, 0);
  for (const url of ['/', '/competitions', '/rating', '/calendar', '/news', '/documents', '/about', '/login']) {
    assert.equal((await request(url)).status, 200, url);
  }
});

test('организатор создаётся только по ссылке из консоли и только один раз', async () => {
  assert.equal((await request('/setup')).status, 403);
  assert.equal((await request('/setup?token=неверный')).status, 403);
  const token = setupToken();
  assert.equal((await request(`/setup?token=${token}`)).status, 200);

  const weak = await request('/setup', { token, email: 'org@fsp-rd.ru', password: 'короткий', password2: 'короткий' });
  assert.equal(weak.status, 400);

  const ok = await request('/setup', { token, email: 'org@fsp-rd.ru', password: 'надёжный-пароль', password2: 'надёжный-пароль' });
  assert.equal(ok.status, 303);
  assert.equal(ok.location, '/admin');
  assert.equal(get("SELECT role FROM users WHERE email = 'org@fsp-rd.ru'").role, 'ORGANIZER');

  const panel = await request('/admin');
  assert.equal(panel.status, 200);
  assert.match(panel.text, /Первые шаги/);

  assert.equal((await request(`/setup?token=${token}`)).status, 404, 'после настройки ссылка закрыта');
});

test('контакты Федерации из настроек появляются на сайте, опасные ссылки не принимаются', async () => {
  const fields = { org_name: 'Федерация спортивного программирования Республики Дагестан', about: '', address: '', phone: '+7 (900) 000-00-00', email: 'info@fsp-rd.ru', telegram: '', vk: '' };
  assert.equal((await request('/admin/settings', { ...fields, vk: 'javascript:alert(1)' })).status, 400);
  assert.equal((await request('/admin/settings', fields)).status, 303);
  const home = await request('/');
  assert.match(home.text, /mailto:info@fsp-rd\.ru/);
  assert.match(home.text, /tel:\+79000000000/);
  assert.doesNotMatch(home.text, /javascript:/);
  assert.match((await request('/about')).text, /Контакты/);
});
