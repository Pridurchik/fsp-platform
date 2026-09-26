import { errorPage } from './pages/errors.js';

export function requireUser(ctx) {
  if (ctx.user) return true;
  ctx.redirect(`/login?next=${encodeURIComponent(ctx.url.pathname + ctx.url.search)}`, {
    type: 'info',
    text: 'Войдите, чтобы продолжить.',
  });
  return false;
}

export function requireAthlete(ctx) {
  if (!requireUser(ctx)) return false;
  if (ctx.athlete) return true;
  ctx.html(errorPage(ctx, 403, 'Этот раздел для спортсменов. Вы вошли как организатор.'), 403);
  return false;
}

export function requireOrganizer(ctx) {
  if (!requireUser(ctx)) return false;
  if (ctx.isOrganizer) return true;
  ctx.html(errorPage(ctx, 403, 'Раздел доступен только организаторам Федерации.'), 403);
  return false;
}

// Разрешаем возвращать пользователя только на страницы этого же сайта.
export function safeNext(value, fallback = '/') {
  const v = String(value || '');
  return v.startsWith('/') && !v.startsWith('//') ? v : fallback;
}
