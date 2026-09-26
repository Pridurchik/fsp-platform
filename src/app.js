// Обработка запроса: статика, cookie, сессия, защита форм, маршрутизация.
import path from 'node:path';
import { ROOT, config } from './config.js';
import { parseCookies, serializeCookie, readBody, serveStatic } from './core/http.js';
import { getSessionUser, SESSION_COOKIE, CSRF_COOKIE, newCsrfToken, safeEqual, isOrganizer } from './core/auth.js';
import { athleteByUser } from './modules/athletes.js';
import { matchRoute } from './routes.js';
import { errorPage } from './web/pages/errors.js';

const PUBLIC_DIR = path.join(ROOT, 'public');
const FLASH_COOKIE = 'fsp_flash';
const MOBILE_PREFIX = '/api/mobile/';

export async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method === 'HEAD' ? 'GET' : req.method;

  if (method === 'GET' && url.pathname.startsWith('/static/')) {
    if (await serveStatic(req, res, PUBLIC_DIR, url.pathname.slice('/static/'.length))) return;
  }
  if (method === 'GET' && url.pathname === '/favicon.svg') {
    if (await serveStatic(req, res, PUBLIC_DIR, 'favicon.svg')) return;
  }

  if (url.pathname.startsWith(MOBILE_PREFIX)) return handleMobile(req, res, url, method);

  const cookies = parseCookies(req.headers.cookie);
  const setCookies = [];

  let csrf = cookies[CSRF_COOKIE];
  if (!csrf || csrf.length < 16) {
    csrf = newCsrfToken();
    setCookies.push(serializeCookie(CSRF_COOKIE, csrf, { maxAge: 60 * 60 * 24 * 30, secure: config.secureCookies }));
  }

  let flash = null;
  if (cookies[FLASH_COOKIE]) {
    try {
      flash = JSON.parse(cookies[FLASH_COOKIE]);
    } catch {
      flash = null;
    }
    setCookies.push(serializeCookie(FLASH_COOKIE, '', { maxAge: 0 }));
  }

  const user = getSessionUser(cookies[SESSION_COOKIE]);
  const ctx = {
    req,
    res,
    url,
    method,
    query: url.searchParams,
    cookies,
    setCookies,
    params: {},
    form: null,
    user,
    athlete: user ? athleteByUser(user.id) || null : null,
    isOrganizer: isOrganizer(user),
    csrf,
    flash,
    config,

    send(status, body, headers = {}) {
      if (res.headersSent) return;
      const h = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', ...headers };
      if (setCookies.length) h['set-cookie'] = setCookies;
      res.writeHead(status, h);
      res.end(req.method === 'HEAD' ? undefined : body);
    },
    html(body, status = 200) {
      ctx.send(status, String(body), {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-frame-options': 'SAMEORIGIN',
      });
    },
    json(data, status = 200) {
      ctx.send(status, JSON.stringify(data, null, 2), {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
    },
    file(body, filename, type) {
      ctx.send(200, body, {
        'content-type': type,
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      });
    },
    redirect(location, message) {
      if (message) {
        const payload = typeof message === 'string' ? { type: 'ok', text: message } : message;
        setCookies.push(serializeCookie(FLASH_COOKIE, JSON.stringify(payload), { maxAge: 60 }));
      }
      ctx.send(303, '', { location });
    },
    setCookie(name, value, options) {
      setCookies.push(serializeCookie(name, value, { secure: config.secureCookies, ...options }));
    },
  };

  if (method === 'POST') {
    ctx.form = new URLSearchParams(await readBody(req));
    // Защита от подделки запросов: токен из формы должен совпасть с токеном из cookie.
    if (!safeEqual(ctx.form.get('_csrf') || '', cookies[CSRF_COOKIE] || '')) {
      return ctx.html(errorPage(ctx, 403, 'Форма устарела. Обновите страницу и отправьте её ещё раз.'), 403);
    }
  } else if (method !== 'GET') {
    return ctx.html(errorPage(ctx, 405), 405);
  }

  const match = matchRoute(method, url.pathname);
  if (!match) return ctx.html(errorPage(ctx, 404), 404);
  ctx.params = match.params;
  await match.handler(ctx);
}

// API мобильного приложения: JSON и вход по токену из заголовка Authorization.
// Cookie здесь не принимаются, поэтому защита форм не нужна: браузер не подставит токен сам.
async function handleMobile(req, res, url, method) {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const user = getSessionUser(token);
  const ctx = {
    req,
    res,
    url,
    method,
    query: url.searchParams,
    params: {},
    body: {},
    token,
    user,
    athlete: user ? athleteByUser(user.id) || null : null,
    isOrganizer: isOrganizer(user),
    config,
    json(data, status = 200) {
      if (res.headersSent) return;
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data));
    },
  };

  if (method === 'POST') {
    const raw = await readBody(req);
    if (raw.trim()) {
      try {
        ctx.body = JSON.parse(raw);
      } catch {
        return ctx.json({ error: 'Тело запроса должно быть в формате JSON' }, 400);
      }
    }
    if (!ctx.body || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) ctx.body = {};
  } else if (method !== 'GET') {
    return ctx.json({ error: 'Метод не поддерживается' }, 405);
  }

  const match = matchRoute(method, url.pathname);
  if (!match) return ctx.json({ error: 'Не найдено' }, 404);
  ctx.params = match.params;
  await match.handler(ctx);
}
