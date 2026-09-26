// Хакатон на сайте: расписание (организатор ведёт, все видят) и чат допущенных участников.
// Уведомления о начале пунктов рассылает сервер (src/modules/schedule.js), приложение показывает их на телефоне.
import { html, paragraphs } from '../../core/html.js';
import { layout } from '../layout.js';
import * as ui from '../ui.js';
import { fmtRange } from '../../core/dates.js';
import { getCompetition } from '../../modules/competitions.js';
import { openChat, listMessages, postMessage, markRead, athleteMembersCount, MESSAGE_MAX } from '../../modules/chats.js';
import {
  SCHEDULE_KINDS, listSchedule, readScheduleInput, validateScheduleItem, addScheduleItem, deleteScheduleItem, NOTIFY_GRACE_MINUTES,
} from '../../modules/schedule.js';
import { adminPage, competitionTabs } from '../admin-layout.js';
import { requireUser, requireOrganizer } from '../guards.js';
import { errorPage } from './errors.js';

const notFound = (ctx) => ctx.html(errorPage(ctx, 404), 404);

const TIME_FMT = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const DAY_FMT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });
const fromUtc = (s) => new Date(String(s).replace(' ', 'T') + 'Z');

// Список пунктов расписания: на странице соревнования и в кабинете организатора.
export function scheduleList(items, { admin = null } = {}) {
  if (!items.length) return html`<p class="muted">Расписание пока не опубликовано.</p>`;
  const next = items.find((s) => !s.is_past);
  return html`<ol class="schedule-list">${items.map((s) => html`<li id="schedule-${s.id}" class="${s.is_past ? 'is-past' : ''} ${next?.id === s.id ? 'is-next' : ''}">
    <span class="schedule-time mono">${s.date_short}<b>${s.time}</b></span>
    <div class="schedule-body">
      <span class="schedule-kind kind-${s.kind.toLowerCase()}">${s.kind_label}</span>
      <b>${s.title}</b>
      ${s.description ? html`<span class="sub">${s.description}</span>` : ''}
      ${admin && s.notified_at ? html`<span class="sub">Уведомление отправлено участникам</span>` : ''}
    </div>
    ${admin ? html`<form method="post" action="/admin/schedule/${s.id}/delete" data-confirm="Удалить пункт «${s.title}»?">${ui.csrf(admin)}
      <button class="btn-link danger" type="submit">Удалить</button></form>` : next?.id === s.id ? html`<span class="pill pill-brand">Далее</span>` : ''}
  </li>`)}</ol>`;
}

function chatLog(ctx, messages) {
  if (!messages.length) return html`<p class="muted">Сообщений пока нет. Напишите первым.</p>`;
  let day = '';
  return html`<ol class="chat-log">${messages.map((m) => {
    const at = fromUtc(m.created_at);
    const d = DAY_FMT.format(at);
    const sep = d !== day ? ((day = d), html`<li class="chat-day">${d}</li>`) : '';
    if (m.author.kind === 'system') return html`${sep}<li class="chat-system">${m.body}<span>${TIME_FMT.format(at)}</span></li>`;
    const mine = m.user_id === ctx.user.id;
    return html`${sep}<li class="chat-msg ${mine ? 'is-mine' : ''} ${m.author.kind === 'organizer' ? 'is-org' : ''}">
      <span class="chat-author">${m.author.name}<span>${TIME_FMT.format(at)}</span></span>
      <div class="chat-text">${paragraphs(m.body)}</div></li>`;
  })}</ol>`;
}

function chatForm(ctx, action) {
  return html`<form method="post" action="${action}" class="form chat-form" id="chat-bottom">${ui.csrf(ctx)}
    ${ui.textarea({ label: 'Сообщение', name: 'body', rows: 3, attrs: `maxlength="${MESSAGE_MAX}" required` })}
    <div class="form-actions"><button class="btn btn-accent" type="submit">Отправить</button>
      <span class="hint">Сообщение организатора приходит участникам уведомлением</span></div></form>`;
}

// ---------- чат для спортсмена ----------

export function chatPage(ctx) {
  if (!requireUser(ctx)) return;
  const opened = openChat(ctx.user, Number(ctx.params.id));
  if (!opened) return ctx.html(errorPage(ctx, 403, 'Чат доступен участникам, чью заявку одобрил организатор.'), 403);
  const { chat, competition: c } = opened;
  const messages = listMessages(chat.id, { limit: 100 });
  if (messages.length) markRead(chat.id, ctx.user.id, messages[messages.length - 1].id);
  const body = html`<section class="wrap section page-readable">
    ${ui.pageHead({ crumbs: [['/competitions', 'Соревнования'], [`/competitions/${c.id}`, c.title]], title: 'Чат участников',
      lede: `${c.title} · ${fmtRange(c.start_date, c.end_date)} · участников в чате: ${athleteMembersCount(chat.id)}` })}
    ${chatLog(ctx, messages)}
    ${chatForm(ctx, `/competitions/${c.id}/chat`)}
  </section>`;
  ctx.html(layout(ctx, { title: `Чат: ${c.title}`, section: 'competitions', body }));
}

export function sendChat(ctx) {
  if (!requireUser(ctx)) return;
  const id = Number(ctx.params.id);
  const r = postMessage(ctx.user, id, ctx.form.get('body'));
  const back = ctx.isOrganizer && String(ctx.form.get('from')) === 'admin' ? `/admin/competitions/${id}/schedule#chat` : `/competitions/${id}/chat`;
  if (r.error) return ctx.redirect(back, { type: 'error', text: r.error });
  ctx.redirect(`${back}${back.includes('#') ? '' : '#chat-bottom'}`);
}

// ---------- кабинет организатора: расписание и чат ----------

function schedulePage(ctx, c, { values = {}, errors = {} } = {}) {
  const items = listSchedule(c.id);
  const opened = openChat(ctx.user, c.id);
  const messages = listMessages(opened.chat.id, { limit: 50 });
  if (messages.length) markRead(opened.chat.id, ctx.user.id, messages[messages.length - 1].id);
  const v = { kind: 'CHECKPOINT', date: c.start_date, ...values };
  return adminPage(ctx, { title: 'Расписание и чат', active: 'competitions', body: html`
    ${ui.pageHead({ crumbs: [['/admin/competitions', 'Соревнования'], [`/admin/competitions/${c.id}`, c.title]], title: 'Расписание и чат',
      lede: html`${c.title} · ${fmtRange(c.start_date, c.end_date)} · ${ui.statusPill(c.status)}` })}
    ${competitionTabs(c, 'schedule')}
    <div class="detail-grid">
      <div>
        <h2 class="h3">Расписание</h2>
        <p class="muted small">Пока соревнование идёт, в момент начала пункта допущенные участники получают уведомление в кабинет и на телефон, а в чат приходит сообщение. Если соревнование запущено позже, пункты старше ${NOTIFY_GRACE_MINUTES} минут не рассылаются.</p>
        ${scheduleList(items, { admin: ctx })}
        <form method="post" action="/admin/competitions/${c.id}/schedule" class="form panel" novalidate>${ui.csrf(ctx)}
          <h3 class="h4">Добавить пункт</h3>
          ${ui.select({ label: 'Тип', name: 'kind', value: v.kind, error: errors.kind, required: true,
            options: Object.entries(SCHEDULE_KINDS).map(([value, label]) => ({ value, label })) })}
          ${ui.field({ label: 'Название', name: 'title', value: v.title, error: errors.title, required: true, attrs: 'placeholder="Чекпоинт 1: прототип"' })}
          <div class="form-grid">
            ${ui.field({ label: 'Дата', name: 'date', type: 'date', value: v.date, error: errors.date, required: true })}
            ${ui.field({ label: 'Время начала', name: 'time', type: 'time', value: v.time, error: errors.time, required: true })}
          </div>
          ${ui.textarea({ label: 'Описание', name: 'description', value: v.description || '', rows: 2, hint: 'Необязательно: что подготовить, где проходит' })}
          <button class="btn btn-accent" type="submit">Добавить в расписание</button>
        </form>
      </div>
      <aside class="side-panel" id="chat">
        <h2 class="h3">Чат участников <span class="muted small">· ${athleteMembersCount(opened.chat.id)}</span></h2>
        <p class="muted small">Спортсмен попадает в чат, когда вы допускаете его заявку на вкладке «Участники».</p>
        ${chatLog(ctx, messages)}
        ${html`<form method="post" action="/competitions/${c.id}/chat" class="form chat-form">${ui.csrf(ctx)}<input type="hidden" name="from" value="admin">
          ${ui.textarea({ label: 'Объявление', name: 'body', id: 'chat-body', rows: 3, attrs: `maxlength="${MESSAGE_MAX}" required` })}
          <button class="btn" type="submit">Отправить участникам</button></form>`}
      </aside>
    </div>` });
}

export function schedule(ctx) {
  if (!requireOrganizer(ctx)) return;
  const c = getCompetition(Number(ctx.params.id));
  if (!c) return notFound(ctx);
  ctx.html(schedulePage(ctx, c));
}

export function addSchedule(ctx) {
  if (!requireOrganizer(ctx)) return;
  const c = getCompetition(Number(ctx.params.id));
  if (!c) return notFound(ctx);
  const item = readScheduleInput(ctx.form);
  const errors = validateScheduleItem(item);
  if (Object.keys(errors).length) return ctx.html(schedulePage(ctx, c, { values: item, errors }), 400);
  addScheduleItem(c.id, item, ctx.user.id);
  ctx.redirect(`/admin/competitions/${c.id}/schedule`, 'Пункт добавлен в расписание.');
}

export function removeSchedule(ctx) {
  if (!requireOrganizer(ctx)) return;
  const r = deleteScheduleItem(Number(ctx.params.id), ctx.user.id);
  if (r.error) return ctx.redirect('/admin/competitions', { type: 'error', text: r.error });
  ctx.redirect(`/admin/competitions/${r.competitionId}/schedule`, 'Пункт удалён.');
}
