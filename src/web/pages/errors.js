import { html } from '../../core/html.js';
import { layout } from '../layout.js';

const TEXTS = {
  403: ['Нет доступа', 'У вашей учётной записи нет прав на эту страницу.'],
  404: ['Страница не найдена', 'Возможно, ссылка устарела или соревнование ещё не опубликовано.'],
  405: ['Метод не поддерживается', 'Эта страница принимает только обычные переходы и формы.'],
  500: ['Что-то сломалось', 'Мы уже видим ошибку в журнале сервера.'],
};

export function errorPage(ctx, status, message) {
  const [title, text] = TEXTS[status] || TEXTS[500];
  return layout(ctx, {
    title,
    body: html`<section class="wrap page-narrow error-page">
      <p class="eyebrow">Ошибка ${status}</p>
      <h1>${title}</h1>
      <p class="lede">${message || text}</p>
      <p class="actions"><a class="btn" href="/">На главную</a> <a class="btn btn-ghost" href="/competitions">К соревнованиям</a></p>
    </section>`,
  });
}
