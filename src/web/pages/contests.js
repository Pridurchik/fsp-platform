// Модуль проведения соревнований (кейс №2): страницы контеста.
// У организатора — задания и проверка решений, у спортсмена — блок контеста на странице соревнования.
import { html, paragraphs } from '../../core/html.js';
import * as ui from '../ui.js';
import { fmtDate, fmtRange, fmtDateTime } from '../../core/dates.js';
import { fmt1, countOf, fullName } from '../../core/format.js';
import { getCompetition, TRANSITIONS } from '../../modules/competitions.js';
import { isProfileComplete } from '../../modules/registrations.js';
import { publishedResults } from '../../modules/results.js';
import {
  getContest, contestWindow, syncContestStatus, listTasks, getTask, readTaskForm, validateTask, addTask as addTaskFn,
  updateTask as updateTaskFn, deleteTask as deleteTaskFn, participation, joinContest, submitSolution, listSubmissions,
  athleteSubmissions, submissionCounts, gradeSubmission, standings, contestPublishProblems, taskStats,
} from '../../modules/contests.js';
import { adminPage, competitionTabs } from '../admin-layout.js';
import { layout } from '../layout.js';
import { requireAthlete, requireOrganizer } from '../guards.js';
import { errorPage } from './errors.js';

const notFound = (ctx) => ctx.html(errorPage(ctx, 404), 404);

// CSV для протокола контеста (тот же формат, что у участников и рейтинга: ; + BOM).
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');

// Контест из параметра маршрута, со сменой статуса по времени, если она включена.
function loadContest(ctx) {
  const c = getCompetition(Number(ctx.params.id));
  if (!c || !c.on_platform) return null;
  return syncContestStatus(c);
}

const countdown = (date, label) => html`<span class="countdown">${label} <b data-countdown="${date.getTime()}">…</b></span>`;

// ---------- страница соревнования: блок контеста ----------

export function contestStatusLine(c, k) {
  const { start, end } = contestWindow(c, k);
  const now = new Date();
  const serverTime = now.toTimeString().slice(0, 5);
  const when = `${fmtRange(c.start_date, c.end_date)}, ${k.start_time}–${k.end_time}`;
  if (c.status === 'PUBLISHED') return html`<p class="contest-status"><span>Контест начнётся ${fmtDate(c.start_date)} в ${k.start_time}</span>${start > now ? countdown(start, 'До начала') : ''}<span class="muted small">Время сервера: ${serverTime}</span></p>`;
  if (c.status === 'ONGOING') return html`<p class="contest-status is-live"><span>Контест идёт · ${when}</span>${end > now ? countdown(end, 'До окончания') : html`<span>Время вышло, организатор завершит контест</span>`}<span class="muted small">Время сервера: ${serverTime} · после кнопки «Завершить» отправка закроется</span></p>`;
  if (c.status === 'FINISHED') return html`<p class="contest-status"><span>Контест завершён. Идёт проверка решений, таблица предварительная</span></p>`;
  if (c.status === 'RESULTS_PUBLISHED') return html`<p class="contest-status"><span>Итоги опубликованы и учтены в рейтинге</span></p>`;
  return '';
}

// Боковая панель на странице контеста, когда регистрация уже закрыта.
export function contestPanel(ctx, c) {
  if (!['ONGOING', 'FINISHED', 'RESULTS_PUBLISHED'].includes(c.status)) return null;
  if (c.status === 'ONGOING') {
    if (ctx.isOrganizer) {
      const n = submissionCounts(c.id);
      return { title: 'Контест идёт', body: html`<p>Решений: ${n.total}, ждут проверки: ${n.pending}.</p><a class="btn btn-block" href="/admin/competitions/${c.id}/submissions">Проверять решения</a>` };
    }
    if (!ctx.user) {
      const next = encodeURIComponent(`/competitions/${c.id}`);
      return { title: 'Контест идёт', body: html`<p>Задания видны участникам. Войдите, чтобы участвовать.</p><div class="stack-actions"><a class="btn" href="/login?next=${next}">Войти</a><a class="btn btn-ghost" href="/register?next=${next}">Регистрация</a></div>` };
    }
    if (!ctx.athlete) return { title: 'Контест идёт', body: html`<p class="muted">Решения отправляют спортсмены.</p>` };
    if (participation(c.id, ctx.athlete.id)) {
      const mine = athleteSubmissions(c.id, ctx.athlete.id);
      return { title: 'Вы участвуете', body: html`<p>Отправлено решений: ${mine.length}, проверено: ${mine.filter((s) => s.score !== null).length}.</p><a class="btn btn-block" href="#tasks">К заданиям</a>` };
    }
    if (!isProfileComplete(ctx.athlete)) {
      return { title: 'Контест идёт', body: html`<p class="notice">Чтобы участвовать, укажите в профиле населённый пункт и образовательную организацию.</p><a class="btn" href="/cabinet/profile?next=${encodeURIComponent(`/competitions/${c.id}`)}">Заполнить профиль</a>` };
    }
    return { title: 'Контест идёт', body: html`<p>Можно присоединиться: задания откроются сразу.</p>
      <form method="post" action="/competitions/${c.id}/join">${ui.csrf(ctx)}<button class="btn btn-accent btn-block" type="submit">Участвовать</button></form>` };
  }
  if (c.status === 'FINISHED') return { title: 'Контест завершён', body: html`<p>Решения проверяются. Предварительная таблица ниже, итоги появятся после публикации.</p>${ctx.isOrganizer ? html`<a class="btn btn-block" href="/admin/competitions/${c.id}/submissions">Проверка и публикация</a>` : ''}` };
  return { title: 'Итоги опубликованы', body: html`<p>Результаты попали в профили участников и в рейтинг Федерации.</p><a class="btn btn-ghost btn-block" href="#results">Итоговая таблица</a>` };
}

function attempts(list) {
  if (!list.length) return '';
  return html`<details class="attempts" ${list.some((s) => s.score === null) ? 'open' : ''}>
    <summary>Ваши попытки: ${list.length}</summary>
    <ul>${list.map((s) => html`<li>
      <span class="attempt-meta">${fmtDateTime(s.created_at)} · ${s.score === null ? html`<span class="pill pill-brand">На проверке</span>` : html`<span class="pill pill-good">${s.score} из ${s.max_score}</span>`}</span>
      ${s.answer_text ? html`<span class="attempt-answer">${s.answer_text.length > 180 ? `${s.answer_text.slice(0, 180)}…` : s.answer_text}</span>` : ''}
      ${s.answer_url ? html`<a href="${s.answer_url}" rel="noopener nofollow" target="_blank">${s.answer_url}</a>` : ''}
      ${s.comment ? html`<span class="attempt-comment">Комментарий проверяющего: ${s.comment}</span>` : ''}</li>`)}</ul>
  </details>`;
}

export function contestBlock(ctx, c, k) {
  const tasks = listTasks(c.id);
  const isParticipant = Boolean(ctx.athlete && participation(c.id, ctx.athlete.id));
  const visible = (c.status === 'ONGOING' && (isParticipant || ctx.isOrganizer)) || ['FINISHED', 'RESULTS_PUBLISHED'].includes(c.status);
  const canSubmit = c.status === 'ONGOING' && isParticipant;
  const mine = ctx.athlete ? athleteSubmissions(c.id, ctx.athlete.id) : [];
  const maxTotal = tasks.reduce((s, t) => s + t.max_score, 0);

  let tasksHtml;
  if (!tasks.length) tasksHtml = html`<p class="muted">Задания ещё не добавлены.</p>`;
  else if (!visible) {
    tasksHtml = html`<p class="muted">${c.status === 'ONGOING'
      ? 'Задания видны участникам контеста.'
      : `Задания откроются в момент старта: ${fmtDate(c.start_date)} в ${k.start_time}.`}</p>`;
  } else {
    tasksHtml = html`<div class="task-list">${tasks.map((t) => {
      const my = mine.filter((s) => s.task_id === t.id);
      const best = my.filter((s) => s.score !== null).reduce((m, s) => Math.max(m, s.score), -1);
      return html`<article class="task-card" id="task-${t.id}">
        <header class="task-head"><span class="task-letter">${t.letter}</span><h3>${t.title}</h3>
          <span class="task-max">${best >= 0 ? html`<span class="pill pill-good">${best} из ${t.max_score}</span>` : `до ${t.max_score} баллов`}</span></header>
        <div class="prose task-statement">${paragraphs(t.statement)}</div>
        ${t.materials_url ? html`<p class="task-materials"><a href="${t.materials_url}" rel="noopener" target="_blank">Материалы к заданию</a></p>` : ''}
        ${canSubmit ? html`<form method="post" action="/tasks/${t.id}/submit" class="form submit-form">${ui.csrf(ctx)}
          ${ui.textarea({ label: 'Ответ или описание решения', name: 'answer_text', id: `answer-${t.id}`, rows: 4 })}
          ${ui.field({ label: 'Ссылка на решение', name: 'answer_url', id: `url-${t.id}`, type: 'url', hint: 'Необязательно: GitHub, Google Диск, Яндекс Диск и т. п.', attrs: 'placeholder="https://..."' })}
          <div class="form-actions"><button class="btn btn-accent" type="submit">Отправить решение</button><span class="hint">Можно отправлять несколько раз, в зачёт идёт лучшая оценка</span></div>
        </form>` : ''}
        ${attempts(my)}
      </article>`;
    })}</div>`;
  }

  const showTable = ['FINISHED', 'RESULTS_PUBLISHED'].includes(c.status);
  return html`<section class="contest" id="tasks">
    ${contestStatusLine(c, k)}
    ${k.rules ? html`<div class="contest-rules"><h2 class="h3">Правила</h2><div class="prose">${paragraphs(k.rules)}</div></div>` : ''}
    <div class="section-head"><h2>Задания</h2>${tasks.length ? html`<span class="muted small">${countOf(tasks.length, ['задание', 'задания', 'заданий'])} · до ${maxTotal} баллов</span>` : ''}</div>
    ${tasksHtml}
    ${showTable ? standingsTable(ctx, c, { final: c.status === 'RESULTS_PUBLISHED' }) : ''}
  </section>`;
}

export function standingsTable(ctx, c, { final = false, compact = false } = {}) {
  const { tasks, rows } = standings(c.id);
  if (!rows.length) return compact ? html`<p class="muted small">Решений пока нет.</p>` : '';
  const points = final ? new Map((publishedResults(c.id)[0]?.rows || []).map((r) => [r.athlete_id, r.points])) : new Map();
  if (compact) {
    return html`<ol class="leader-list">${rows.map((r) => html`<li>${ui.placeMark(r.place)}
      <span class="leader-name">${fullName(r.athlete).split(' ').slice(0, 2).join(' ')}${r.pending ? html`<span class="sub">на проверке: ${r.pending}</span>` : ''}</span>
      <span class="leader-score">${r.total}</span></li>`)}</ol>`;
  }
  return html`<div class="section-head" id="results"><h2>${final ? 'Итоговая таблица' : 'Предварительная таблица'}</h2>
      <span class="muted small">При равной сумме выше тот, кто раньше отправил последнее решение с баллами</span></div>
    <div class="table-wrap"><table class="data standings contest-table">
      <thead><tr><th scope="col" class="num">Место</th><th scope="col">Участник</th>
        ${tasks.map((t) => html`<th scope="col" class="num" title="${t.title}">${t.letter}</th>`)}
        <th scope="col" class="num">Сумма</th>${final ? html`<th scope="col" class="num">В рейтинг</th>` : ''}</tr></thead>
      <tbody>${rows.map((r) => html`<tr class="${ctx.athlete?.id === r.athleteId ? 'is-me' : ''}">
        <td class="num">${ui.placeMark(r.place)}</td>
        <td>${ui.athleteName(r.athlete, { viewer: ctx })}<span class="sub">${r.athlete.organization || ''}</span></td>
        ${tasks.map((t) => {
          const cell = r.cells.get(t.id);
          if (!cell) return html`<td class="num muted">—</td>`;
          return html`<td class="num mono">${cell.best ?? (cell.pending ? html`<span class="muted" title="На проверке">?</span>` : '0')}${cell.attempts > 1 ? html`<span class="sub">попыток: ${cell.attempts}</span>` : ''}</td>`;
        })}
        <td class="num mono strong">${r.total}</td>
        ${final ? html`<td class="num mono">${points.has(r.athleteId) ? fmt1(points.get(r.athleteId)) : '—'}</td>` : ''}</tr>`)}</tbody>
    </table></div>`;
}

export function join(ctx) {
  if (!requireAthlete(ctx)) return;
  const id = Number(ctx.params.id);
  const r = joinContest(ctx.athlete, id);
  if (r.error === 'profile') return ctx.redirect(`/cabinet/profile?next=${encodeURIComponent(`/competitions/${id}`)}`, { type: 'info', text: 'Сначала укажите населённый пункт и образовательную организацию.' });
  if (r.error) return ctx.redirect(`/competitions/${id}`, { type: 'error', text: r.error });
  ctx.redirect(`/competitions/${id}#tasks`, 'Вы участвуете в контесте. Задания открыты ниже.');
}

export function submit(ctx) {
  if (!requireAthlete(ctx)) return;
  const r = submitSolution(ctx.athlete, Number(ctx.params.id), { text: ctx.form.get('answer_text'), url: ctx.form.get('answer_url') });
  if (!r.competitionId) return notFound(ctx);
  if (r.error) return ctx.redirect(`/competitions/${r.competitionId}#task-${ctx.params.id}`, { type: 'error', text: r.error });
  ctx.redirect(`/competitions/${r.competitionId}#task-${ctx.params.id}`, `Решение по заданию ${r.letter} отправлено. Баллы появятся после проверки.`);
}

// ---------- кабинет организатора ----------

// Короткая статистика по заданиям: попытки, проверено, средний и лучший баллы.
function taskStatsList(stats) {
  if (!stats.length) return html`<p class="muted small">Заданий пока нет.</p>`;
  return html`<ol class="leader-list">${stats.map((s) => html`<li>
    <span class="task-letter">${s.letter}</span>
    <span class="leader-name">${s.title}<span class="sub">${s.total ? `попыток: ${s.total}, проверено: ${s.checked}${s.avg !== null ? `, средн. ${s.avg}` : ''}${s.best !== null ? `, лучш. ${s.best}` : ''}` : 'решений нет'}</span></span>
    <span class="leader-score">до ${s.max_score}</span></li>`)}</ol>`;
}

function statusActions(ctx, c, back) {
  const transitions = (TRANSITIONS[c.status] || []).filter((t) => !t.danger && t.action !== 'unpublish');
  if (!transitions.length) return '';
  return html`${transitions.map((t) => html`<form method="post" action="/admin/competitions/${c.id}/transition" class="transition"
      ${t.action === 'publishResults' ? html`data-confirm="Опубликовать итоги и пересчитать рейтинг?"` : t.action === 'finish' ? html`data-confirm="Завершить контест? Отправка решений закроется."` : ''}>
    ${ui.csrf(ctx)}<input type="hidden" name="action" value="${t.action}"><input type="hidden" name="back" value="${back}">
    <button class="btn ${t.accent ? 'btn-accent' : ''} btn-block" type="submit">${t.label}</button>${t.hint ? html`<p class="hint">${t.hint}</p>` : ''}</form>`)}`;
}

function contestHead(c, title, lede) {
  return html`${ui.pageHead({ crumbs: [['/admin/competitions', 'Соревнования'], [`/admin/competitions/${c.id}`, c.title]], title,
    lede: html`${c.title} · ${fmtRange(c.start_date, c.end_date)}${lede ? html`<br>${lede}` : ''}` })}
    ${competitionTabs(c, title === 'Задания' ? 'tasks' : 'submissions')}`;
}

function taskFields(t, errors, prefix) {
  return html`<div class="form-grid task-form-grid">
      ${ui.field({ label: 'Название', name: 'title', id: `${prefix}-title`, value: t.title, error: errors.title, required: true })}
      ${ui.field({ label: 'Максимум баллов', name: 'max_score', id: `${prefix}-max`, type: 'number', value: t.max_score, error: errors.max_score, required: true, attrs: 'min="1" max="10000"' })}
    </div>
    ${ui.textarea({ label: 'Условие', name: 'statement', id: `${prefix}-statement`, value: t.statement, error: errors.statement, rows: 5, required: true, hint: 'Пустая строка начинает новый абзац' })}
    ${ui.field({ label: 'Материалы', name: 'materials_url', id: `${prefix}-url`, value: t.materials_url || '', error: errors.materials_url, hint: 'Необязательно: ссылка на файлы или тесты', attrs: 'placeholder="https://..."' })}`;
}

function tasksPage(ctx, c, { draft = {}, errors = {}, editId = null, editErrors = {}, editValues = null } = {}) {
  const k = getContest(c.id);
  const tasks = listTasks(c.id);
  const counts = submissionCounts(c.id);
  const back = `/admin/competitions/${c.id}/tasks`;
  return adminPage(ctx, { title: 'Задания', active: 'competitions', body: html`${contestHead(c, 'Задания', `Контест: ${k.start_time}–${k.end_time}. Участники увидят задания после старта.`)}
    <div class="detail-grid">
      <div>
        ${tasks.length ? tasks.map((t) => {
          const values = editId === t.id && editValues ? editValues : t;
          return html`<details class="panel task-edit" ${editId === t.id ? 'open' : ''}>
            <summary><span class="task-letter">${t.letter}</span><b>${t.title}</b><span class="muted small">до ${t.max_score} баллов</span></summary>
            <form method="post" action="/admin/tasks/${t.id}" class="form" novalidate>${ui.csrf(ctx)}
              ${taskFields(values, editId === t.id ? editErrors : {}, `task-${t.id}`)}
              <div class="form-actions"><button class="btn" type="submit">Сохранить задание</button></div>
            </form>
            <form method="post" action="/admin/tasks/${t.id}/delete" class="inline-form" data-confirm="Удалить задание «${t.title}»?">${ui.csrf(ctx)}<button class="btn-link danger" type="submit">Удалить задание</button></form>
          </details>`;
        }) : ui.empty('Заданий пока нет. Для контеста достаточно трёх.')}
        <form method="post" action="/admin/competitions/${c.id}/tasks" class="form panel" novalidate id="new-task">${ui.csrf(ctx)}
          <h2 class="h3">Новое задание</h2>
          ${taskFields({ max_score: 100, ...draft }, errors, 'new')}
          <div class="form-actions"><button class="btn btn-accent" type="submit">Добавить задание</button></div>
        </form>
      </div>
      <aside class="side-panel status-panel">
        <h2 class="h3">Статус</h2>
        <p>${ui.statusPill(c.status)}</p>
        ${c.status === 'DRAFT' && !tasks.length ? html`<p class="muted small">Добавьте задания, затем опубликуйте контест.</p>` : ''}
        ${statusActions(ctx, c, back)}
        <ul class="plain-list">
          <li>Заданий: ${tasks.length}<span class="sub">до ${tasks.reduce((s, t) => s + t.max_score, 0)} баллов в сумме</span></li>
          <li><a href="/admin/competitions/${c.id}/submissions">Решений: ${counts.total}</a><span class="sub">ждут проверки: ${counts.pending}</span></li>
        </ul>
        ${c.status !== 'DRAFT' ? html`<a class="btn btn-ghost btn-sm" href="/competitions/${c.id}">Страница контеста на сайте</a>` : ''}
      </aside>
    </div>` });
}

export function tasks(ctx) {
  if (!requireOrganizer(ctx)) return;
  const c = loadContest(ctx);
  if (!c) return notFound(ctx);
  ctx.html(tasksPage(ctx, c));
}

export function addTask(ctx) {
  if (!requireOrganizer(ctx)) return;
  const c = loadContest(ctx);
  if (!c) return notFound(ctx);
  const t = readTaskForm(ctx.form);
  const errors = validateTask(t);
  if (Object.keys(errors).length) return ctx.html(tasksPage(ctx, c, { draft: t, errors }), 400);
  addTaskFn(c.id, t, ctx.user.id);
  ctx.redirect(`/admin/competitions/${c.id}/tasks#new-task`, `Задание «${t.title}» добавлено.`);
}

export function updateTask(ctx) {
  if (!requireOrganizer(ctx)) return;
  const taskId = Number(ctx.params.id);
  const task = getTask(taskId);
  if (!task) return notFound(ctx);
  const t = readTaskForm(ctx.form);
  const errors = validateTask(t);
  if (Object.keys(errors).length) {
    return ctx.html(tasksPage(ctx, getCompetition(task.competition_id), { editId: taskId, editErrors: errors, editValues: t }), 400);
  }
  const r = updateTaskFn(taskId, t, ctx.user.id);
  ctx.redirect(`/admin/competitions/${task.competition_id}/tasks`, r.error ? { type: 'error', text: r.error } : 'Задание сохранено.');
}

export function deleteTask(ctx) {
  if (!requireOrganizer(ctx)) return;
  const r = deleteTaskFn(Number(ctx.params.id), ctx.user.id);
  if (!r.competitionId) return notFound(ctx);
  ctx.redirect(`/admin/competitions/${r.competitionId}/tasks`, r.error ? { type: 'error', text: r.error } : 'Задание удалено.');
}

export function submissions(ctx) {
  if (!requireOrganizer(ctx)) return;
  const c = loadContest(ctx);
  if (!c) return notFound(ctx);
  const showAll = ctx.query.get('show') === 'all';
  const tasks = listTasks(c.id);
  const taskParam = Number(ctx.query.get('task')) || null;
  const taskFilter = tasks.some((t) => t.id === taskParam) ? taskParam : null;
  const counts = submissionCounts(c.id);
  const list = listSubmissions(c.id, { pending: !showAll, taskId: taskFilter });
  const qs = (show, task) => {
    const p = new URLSearchParams();
    if (show) p.set('show', 'all');
    if (task) p.set('task', task);
    const s = p.toString();
    return `/admin/competitions/${c.id}/submissions${s ? `?${s}` : ''}`;
  };
  const back = qs(showAll, taskFilter);
  const problems = c.status === 'FINISHED' ? contestPublishProblems(c.id) : [];

  const body = html`${contestHead(c, 'Решения', 'Откройте решение, выставьте баллы и сохраните: оценка сразу попадает в таблицу.')}
    ${ui.tabs([
      { href: qs(false, taskFilter), label: 'Ждут проверки', count: counts.pending, active: !showAll },
      { href: qs(true, taskFilter), label: 'Все решения', count: counts.total, active: showAll },
    ], 'Фильтр решений')}
    ${tasks.length ? ui.tabs([
      { href: qs(showAll, null), label: 'Все задания', active: !taskFilter },
      ...tasks.map((t) => ({ href: qs(showAll, t.id), label: `${t.letter}. ${t.title.length > 24 ? `${t.title.slice(0, 24)}…` : t.title}`, active: taskFilter === t.id })),
    ], 'Задание') : ''}
    <div class="detail-grid">
      <div class="submission-list">${list.length ? list.map((s) => html`<article class="panel submission ${s.score === null ? 'is-pending' : ''}" id="s-${s.id}">
        <header class="submission-head">
          <div><b>${fullName(s)}</b><span class="sub">${s.organization || ''}</span></div>
          <div class="submission-task"><span class="task-letter">${s.letter}</span>${s.task_title}<span class="sub">${fmtDateTime(s.created_at)}</span></div>
        </header>
        ${s.answer_text ? html`<pre class="answer">${s.answer_text}</pre>` : ''}
        ${s.answer_url ? html`<p class="answer-link"><a href="${s.answer_url}" rel="noopener nofollow" target="_blank">${s.answer_url}</a></p>` : ''}
        <form method="post" action="/admin/submissions/${s.id}/grade" class="grade-form">${ui.csrf(ctx)}
          <input type="hidden" name="back" value="${back}">
          <div class="field grade-score"><label for="score-${s.id}">Баллы</label>
            <div class="grade-input"><input class="input input-num" id="score-${s.id}" name="score" type="number" min="0" max="${s.max_score}" value="${s.score ?? ''}" required><span class="muted">из ${s.max_score}</span></div></div>
          ${ui.field({ label: 'Комментарий участнику', name: 'comment', id: `comment-${s.id}`, value: s.comment || '' })}
          <button class="btn ${s.score === null ? 'btn-accent' : 'btn-ghost'}" type="submit">${s.score === null ? 'Сохранить оценку' : 'Изменить оценку'}</button>
        </form>
        ${s.score !== null ? html`<p class="small muted">Проверено ${fmtDateTime(s.checked_at)}: ${s.score} из ${s.max_score}</p>` : ''}
      </article>`) : ui.empty(taskFilter ? 'По этому заданию решений нет.' : showAll ? 'Решений пока нет.' : 'Все решения проверены.', taskFilter ? html`<a class="btn btn-ghost btn-sm" href="${qs(showAll, null)}">Все задания</a>` : showAll ? '' : html`<a class="btn btn-ghost btn-sm" href="${qs(true, taskFilter)}">Показать все</a>`)}</div>
      <aside class="side-panel status-panel">
        <h2 class="h3">Статус</h2>
        <p>${ui.statusPill(c.status)}</p>
        ${problems.length ? html`<ul class="problems">${problems.map((p) => html`<li>${p}</li>`)}</ul>` : c.status === 'FINISHED' ? html`<p class="ok-note">Все решения проверены: можно публиковать итоги.</p>` : ''}
        ${statusActions(ctx, c, back)}
        <h2 class="h3">Таблица</h2>
        ${standingsTable(ctx, c, { compact: true })}
        <h2 class="h3">По заданиям</h2>
        ${taskStatsList(taskStats(c.id))}
        <div class="stack-actions">
          <a class="btn btn-ghost btn-sm" href="/admin/competitions/${c.id}/protocol.csv">Скачать протокол CSV</a>
          ${['FINISHED', 'RESULTS_PUBLISHED'].includes(c.status) ? html`<a class="btn btn-ghost btn-sm" href="/competitions/${c.id}/protocol">Версия для печати</a>` : ''}
        </div>
        ${c.status !== 'DRAFT' ? html`<a class="btn btn-ghost btn-sm" href="/competitions/${c.id}${['FINISHED', 'RESULTS_PUBLISHED'].includes(c.status) ? '#results' : ''}">Контест на сайте</a>` : ''}
      </aside>
    </div>`;
  ctx.html(adminPage(ctx, { title: 'Решения', active: 'competitions', body }));
}

export function grade(ctx) {
  if (!requireOrganizer(ctx)) return;
  const r = gradeSubmission(Number(ctx.params.id), ctx.form.get('score'), ctx.form.get('comment'), ctx.user.id);
  if (!r.competitionId) return notFound(ctx);
  const back = String(ctx.form.get('back') || '');
  const target = back.startsWith(`/admin/competitions/${r.competitionId}/submissions`) ? back : `/admin/competitions/${r.competitionId}/submissions`;
  ctx.redirect(target, r.error ? { type: 'error', text: r.error } : 'Оценка сохранена и учтена в таблице.');
}

// ---------- протокол: CSV и печатная версия ----------

// Итоговая таблица контеста для жюри и Федерации: место, ФИО, организация, баллы по заданиям, сумма.
export function protocolCsv(ctx) {
  if (!requireOrganizer(ctx)) return;
  const c = loadContest(ctx);
  if (!c) return notFound(ctx);
  const { tasks, rows } = standings(c.id);
  const header = ['Место', 'Фамилия', 'Имя', 'Отчество', 'Организация', ...tasks.map((t) => `${t.letter} (${t.max_score})`), 'Сумма'];
  const lines = rows.map((r) => [
    r.place, r.athlete.last_name, r.athlete.first_name, r.athlete.middle_name || '', r.athlete.organization || '',
    ...tasks.map((t) => {
      const cell = r.cells.get(t.id);
      return cell?.best ?? '';
    }),
    r.total,
  ]);
  ctx.file(toCsv([header, ...lines]), `protokol-${c.id}.csv`, 'text/csv; charset=utf-8');
}

// Печатная версия протокола: та же таблица, без форм и сайдбара. Видна, когда итоги уже считаются.
export function protocolPage(ctx) {
  let c = getCompetition(Number(ctx.params.id));
  if (!c || !c.on_platform) return notFound(ctx);
  if (c.status === 'DRAFT' && !ctx.isOrganizer) return notFound(ctx);
  c = syncContestStatus(c);
  const k = getContest(c.id);
  const showTable = ['FINISHED', 'RESULTS_PUBLISHED'].includes(c.status);
  const body = html`<section class="wrap section page-readable protocol">
    ${ui.pageHead({
      crumbs: [['/competitions', 'Соревнования'], [`/competitions/${c.id}`, c.title]],
      eyebrow: `Протокол · ${fmtRange(c.start_date, c.end_date)}${k ? ` · ${k.start_time}–${k.end_time}` : ''}`,
      title: `Протокол: ${c.title}`,
      lede: c.status === 'RESULTS_PUBLISHED' ? 'Итоговая таблица. Результаты учтены в рейтинге.' : 'Предварительная таблица.',
      actions: ctx.isOrganizer ? html`<a class="btn btn-ghost btn-sm" href="/admin/competitions/${c.id}/protocol.csv">Скачать CSV</a>` : '',
    })}
    ${showTable ? standingsTable(ctx, c, { final: c.status === 'RESULTS_PUBLISHED' }) : html`<p class="muted">Протокол появится после завершения контеста.</p>`}
    <p class="muted small protocol-sign">Главный судья ________________ / Дата ________________</p>
    <p class="protocol-print"><button class="btn" type="button" onclick="window.print()">Печать</button></p>
  </section>`;
  ctx.html(layout(ctx, { title: `Протокол: ${c.title}`, section: 'competitions', body }));
}

