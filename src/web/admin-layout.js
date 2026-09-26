// Каркас страниц кабинета организатора: меню разделов и вкладки внутри соревнования.
import { html } from '../core/html.js';
import { layout } from './layout.js';
import * as ui from './ui.js';

const SUBNAV = [
  ['dashboard', '/admin', 'Панель'],
  ['competitions', '/admin/competitions', 'Соревнования'],
  ['athletes', '/admin/athletes', 'Спортсмены'],
  ['dictionaries', '/admin/dictionaries', 'Справочники и веса'],
  ['content', '/admin/content', 'Новости и документы'],
  ['settings', '/admin/settings', 'Настройки сайта'],
];

export function adminPage(ctx, { title, active, body }) {
  return layout(ctx, {
    title,
    body: html`<div class="admin-bar"><div class="wrap admin-bar-row"><span class="admin-label">Кабинет организатора</span>
      ${ui.tabs(SUBNAV.map(([key, href, label]) => ({ href, label, active: key === active })), 'Разделы управления')}</div></div>
      <section class="wrap section">${body}</section>`,
  });
}

// Вкладки одного соревнования. «Задания» и «Решения» есть только у контеста на платформе.
// «Расписание и чат»: пункты хакатона с уведомлениями участникам и чат допущенных участников.
export function competitionTabs(c, active) {
  const base = `/admin/competitions/${c.id}`;
  const items = [
    ['card', base, 'Карточка'],
    ['participants', `${base}/participants`, 'Участники'],
    ...(c.on_platform ? [['tasks', `${base}/tasks`, 'Задания'], ['submissions', `${base}/submissions`, 'Решения']] : []),
    ['results', `${base}/results`, 'Результаты'],
    ['schedule', `${base}/schedule`, 'Расписание и чат'],
  ];
  return ui.tabs(items.map(([key, href, label]) => ({ href, label, active: key === active })), 'Разделы соревнования');
}
