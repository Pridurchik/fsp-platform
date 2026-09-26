// Вход, регистрация, выход и создание первого аккаунта организатора.
import { html } from '../../core/html.js';
import { layout } from '../layout.js';
import * as ui from '../ui.js';
import { get, run } from '../../db/index.js';
import {
  hashPassword, verifyPassword, createSession, destroySession, SESSION_COOKIE, loginKey, loginBlocked, loginFailed, loginSucceeded,
} from '../../core/auth.js';
import { needsSetup, isSetupToken, finishSetup } from '../../core/setup.js';
import { audit } from '../../modules/notifications.js';
import { readRegistration, validateRegistration, createAthleteAccount } from '../../modules/athletes.js';
import { safeNext } from '../guards.js';
import { errorPage } from './errors.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function startSession(ctx, userId) {
  const { token, maxAge } = createSession(userId);
  ctx.setCookie(SESSION_COOKIE, token, { maxAge });
}

const homeFor = (role) => (role === 'ORGANIZER' || role === 'ADMIN' ? '/admin' : '/cabinet');

// Быстрый вход в пример наполнения (npm run sample). Работает только для вымышленных аккаунтов
// и только когда пример загружен: на чистой установке кнопок нет.
export const SAMPLE_ACCOUNTS = {
  organizer: { email: 'organizer@example.com', label: 'Организатор', hint: 'Контест, задания, проверка решений' },
  novice: { email: 'novice@example.com', label: 'Спортсмен', hint: 'Сабина Юсупова: тестовый контест и чат хакатона' },
  athlete: { email: 'athlete@example.com', label: 'Лидер рейтинга', hint: 'Амир Гасанов, разбор рейтинга в профиле' },
};
export const sampleLoaded = () => Boolean(get("SELECT 1 AS x FROM settings WHERE key = 'sample_data' AND value = '1'"));

function loginPage(ctx, { email = '', error = '', next = '' } = {}) {
  return layout(ctx, {
    title: 'Вход',
    body: html`<section class="wrap auth-wrap">
      <div class="auth-card">
        <h1>Вход</h1>
        <p class="muted">Для спортсменов и организаторов Федерации.</p>
        ${needsSetup() ? html`<p class="notice">Платформа ещё не настроена. Создайте аккаунт организатора по ссылке, которую сервер показал в консоли при запуске.</p>` : ''}
        ${error ? html`<p class="form-error" role="alert" tabindex="-1" data-error-summary>${error}</p>` : ''}
        <form method="post" action="/login" class="form">
          ${ui.csrf(ctx)}<input type="hidden" name="next" value="${next}">
          ${ui.field({ label: 'Электронная почта', name: 'email', type: 'email', value: email, required: true, attrs: 'autocomplete="email"' })}
          ${ui.field({ label: 'Пароль', name: 'password', type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
          <button class="btn btn-accent btn-block" type="submit">Войти</button>
        </form>
        <p class="auth-switch">Ещё нет аккаунта? <a href="/register${next ? `?next=${encodeURIComponent(next)}` : ''}">Зарегистрируйтесь как спортсмен</a></p>
      </div>
      ${sampleLoaded() ? html`<div class="sample-login">
        <p class="desk-label">Пример наполнения</p>
        <p class="muted small">Вымышленные аккаунты для показа. Пароль у всех: example123.</p>
        ${Object.entries(SAMPLE_ACCOUNTS).map(([key, a]) => html`<form method="post" action="/demo-login">${ui.csrf(ctx)}
          <input type="hidden" name="as" value="${key}"><input type="hidden" name="next" value="${next}">
          <button class="sample-account" type="submit"><b>${a.label}</b><span>${a.hint}</span></button></form>`)}
      </div>` : ''}
    </section>`,
  });
}

export function demoLogin(ctx) {
  const account = SAMPLE_ACCOUNTS[String(ctx.form.get('as') || '')];
  const user = account && sampleLoaded() ? get('SELECT * FROM users WHERE email = ?', account.email) : null;
  if (!user) return ctx.redirect('/login', { type: 'error', text: 'Быстрый вход доступен только с примером наполнения: npm run sample' });
  destroySession(ctx.cookies[SESSION_COOKIE]);
  startSession(ctx, user.id);
  ctx.redirect(safeNext(ctx.form.get('next'), '') || homeFor(user.role));
}

export function loginForm(ctx) {
  if (ctx.user) return ctx.redirect(homeFor(ctx.user.role));
  ctx.html(loginPage(ctx, { next: safeNext(ctx.query.get('next'), '') }));
}

export function login(ctx) {
  const email = String(ctx.form.get('email') || '').trim().toLowerCase();
  const password = String(ctx.form.get('password') || '');
  const next = safeNext(ctx.form.get('next'), '');
  const key = loginKey(ctx.req, email);
  if (loginBlocked(key)) {
    return ctx.html(loginPage(ctx, { email, next, error: 'Слишком много попыток входа. Попробуйте через 15 минут.' }), 429);
  }
  const user = get('SELECT * FROM users WHERE email = ?', email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    loginFailed(key);
    return ctx.html(loginPage(ctx, { email, next, error: 'Неверная почта или пароль. Проверьте раскладку и попробуйте ещё раз.' }), 400);
  }
  loginSucceeded(key);
  startSession(ctx, user.id);
  ctx.redirect(next || homeFor(user.role));
}

// ---------- первый запуск ----------

function setupPage(ctx, { token, values = {}, errors = {} }) {
  return layout(ctx, {
    title: 'Настройка платформы',
    body: html`<section class="wrap auth-wrap">
      <div class="auth-card">
        <p class="eyebrow">Первый запуск</p>
        <h1>Аккаунт организатора</h1>
        <p class="muted">Этот аккаунт управляет соревнованиями, результатами, справочниками и рейтингом. Ссылка одноразовая: после создания аккаунта она перестанет работать.</p>
        <form method="post" action="/setup" class="form" novalidate>
          ${ui.csrf(ctx)}<input type="hidden" name="token" value="${token}">
          ${ui.field({ label: 'Электронная почта', name: 'email', type: 'email', value: values.email, error: errors.email, required: true, attrs: 'autocomplete="email"' })}
          ${ui.field({ label: 'Пароль', name: 'password', type: 'password', error: errors.password, required: true, hint: 'Не короче 10 символов', attrs: 'autocomplete="new-password" minlength="10"' })}
          ${ui.field({ label: 'Пароль ещё раз', name: 'password2', type: 'password', error: errors.password2, required: true, attrs: 'autocomplete="new-password"' })}
          <button class="btn btn-accent btn-block" type="submit">Создать аккаунт</button>
        </form>
      </div>
    </section>`,
  });
}

function setupAllowed(ctx, token) {
  if (!needsSetup()) {
    ctx.html(errorPage(ctx, 404), 404);
    return false;
  }
  if (!isSetupToken(token)) {
    ctx.html(errorPage(ctx, 403, 'Ссылка недействительна. Возьмите актуальную ссылку из консоли сервера: она обновляется при каждом запуске.'), 403);
    return false;
  }
  return true;
}

export function setupForm(ctx) {
  const token = String(ctx.query.get('token') || '');
  if (!setupAllowed(ctx, token)) return;
  ctx.html(setupPage(ctx, { token }));
}

export function setup(ctx) {
  const token = String(ctx.form.get('token') || '');
  if (!setupAllowed(ctx, token)) return;
  const values = { email: String(ctx.form.get('email') || '').trim().toLowerCase() };
  const password = String(ctx.form.get('password') || '');
  const errors = {};
  if (!EMAIL_RE.test(values.email)) errors.email = 'Проверьте адрес почты';
  else if (get('SELECT id FROM users WHERE email = ?', values.email)) errors.email = 'Эта почта уже зарегистрирована';
  if (password.length < 10) errors.password = 'Пароль должен быть не короче 10 символов';
  else if (password !== String(ctx.form.get('password2') || '')) errors.password2 = 'Пароли не совпадают';
  if (Object.keys(errors).length) return ctx.html(setupPage(ctx, { token, values, errors }), 400);

  const userId = run('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', values.email, hashPassword(password), 'ORGANIZER').id;
  audit(userId, 'CREATE', 'user', userId);
  finishSetup();
  startSession(ctx, userId);
  ctx.redirect('/admin', 'Аккаунт организатора создан. Начните с шагов на панели.');
}

function registerPage(ctx, { values = {}, errors = {}, next = '' } = {}) {
  return layout(ctx, {
    title: 'Регистрация',
    body: html`<section class="wrap auth-wrap">
      <div class="auth-card auth-wide">
        <h1>Регистрация спортсмена</h1>
        <p class="muted">После регистрации заполните профиль: населённый пункт, образовательную организацию и дисциплины.</p>
        <form method="post" action="/register" class="form" novalidate>
          ${ui.csrf(ctx)}<input type="hidden" name="next" value="${next}">
          <div class="form-grid">
            ${ui.field({ label: 'Фамилия', name: 'last_name', value: values.last_name, error: errors.last_name, required: true, attrs: 'autocomplete="family-name"' })}
            ${ui.field({ label: 'Имя', name: 'first_name', value: values.first_name, error: errors.first_name, required: true, attrs: 'autocomplete="given-name"' })}
          </div>
          ${ui.field({ label: 'Отчество', name: 'middle_name', value: values.middle_name, hint: 'Если есть', attrs: 'autocomplete="additional-name"' })}
          ${ui.field({ label: 'Электронная почта', name: 'email', type: 'email', value: values.email, error: errors.email, required: true, attrs: 'autocomplete="email"' })}
          ${ui.field({ label: 'Пароль', name: 'password', type: 'password', error: errors.password, required: true, hint: 'Не короче 8 символов', attrs: 'autocomplete="new-password" minlength="8"' })}
          <label class="check check-single ${errors.consent ? 'has-error' : ''}"><input type="checkbox" name="consent" value="1" ${values.consent ? html`checked` : ''} ${errors.consent ? html`aria-invalid="true" aria-describedby="consent-error"` : ''}>
            <span>Согласен на обработку персональных данных. Если спортсмену нет 18 лет, согласие даёт родитель или законный представитель.</span></label>
          ${errors.consent ? html`<p class="field-error" id="consent-error">${errors.consent}</p>` : ''}
          <button class="btn btn-accent btn-block" type="submit">Зарегистрироваться</button>
        </form>
        <p class="auth-switch">Уже есть аккаунт? <a href="/login${next ? `?next=${encodeURIComponent(next)}` : ''}">Войдите</a></p>
      </div>
    </section>`,
  });
}

export function registerForm(ctx) {
  if (ctx.user) return ctx.redirect(homeFor(ctx.user.role));
  ctx.html(registerPage(ctx, { next: safeNext(ctx.query.get('next'), '') }));
}

export function register(ctx) {
  const values = readRegistration(ctx.form);
  const password = String(ctx.form.get('password') || '');
  const next = safeNext(ctx.form.get('next'), '');
  const errors = validateRegistration(values, password);
  if (Object.keys(errors).length) return ctx.html(registerPage(ctx, { values, errors, next }), 400);

  const userId = createAthleteAccount(values, password);
  startSession(ctx, userId);
  ctx.redirect(`/cabinet/profile?welcome=1${next ? `&next=${encodeURIComponent(next)}` : ''}`, 'Аккаунт создан. Заполните профиль, чтобы подавать заявки.');
}

export function logout(ctx) {
  destroySession(ctx.cookies[SESSION_COOKIE]);
  ctx.setCookie(SESSION_COOKIE, '', { maxAge: 0 });
  ctx.redirect('/', 'Вы вышли из аккаунта.');
}
