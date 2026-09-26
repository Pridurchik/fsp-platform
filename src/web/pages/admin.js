// Кабинет организатора: соревнования, участники, результаты, спортсмены, справочники, контент.
import { html } from '../../core/html.js';
import * as ui from '../ui.js';
import { get, all } from '../../db/index.js';
import { todayISO, addDays, fmtDate, fmtRange, fmtDateTime, ageYears } from '../../core/dates.js';
import { fmt1, fmtK, signed, fullName, countOf } from '../../core/format.js';
import {
  listCompetitions, getCompetition, eventsOf, registrationInfo, readCompetitionForm, validateCompetition, createCompetition as createComp,
  updateCompetition as updateComp, applyTransition, TRANSITIONS, STATUS_LABELS, FORMAT_LABELS, competitionMeta,
} from '../../modules/competitions.js';
import { competitionRegistrations, setRegistrationStatus, REG_STATUS_LABELS } from '../../modules/registrations.js';
import {
  resultRows, saveResultsFromForm, autoPlace, addAthleteToEvent, setParticipantsTotal, validateForPublish, publishResults,
} from '../../modules/results.js';
import {
  getAthlete, listAthletes, readProfileForm, validateProfile, createAthlete as createAth, athleteDisciplines, rankHistory, readRankForm,
  validateRank, assignRank as assignRankFn, reviewRank as reviewRankFn, pendingRanks, RANK_STATUS_LABELS,
} from '../../modules/athletes.js';
import {
  listDisciplines, listLevels, listRanks, listTags, listLanguages, listMunicipalities, listOrganizations, updateLevels, updateRanks, updateDisciplines,
  addLevel, addDiscipline, addMunicipality, addOrganization, ORG_KINDS, MUNICIPALITY_KINDS,
} from '../../modules/dictionaries.js';
import { getRatingConfig, saveRatingConfig, qualificationsMap, computeAll, leaderboard } from '../../modules/rating/service.js';
import { kPlace, kField } from '../../modules/rating/engine.js';
import { athleteResults } from '../../modules/results.js';
import { listNews, createNews as createNewsFn, deleteNews as deleteNewsFn, listDocuments, createDocument as createDocFn, deleteDocument as deleteDocFn, DOC_CATEGORIES } from '../../modules/content.js';
import { recentAudit } from '../../modules/notifications.js';
import { SETTINGS_FIELDS, getSettings, readSettingsForm, validateSettings, saveSettings as saveSettingsFn } from '../../modules/settings.js';
import { requireOrganizer, safeNext } from '../guards.js';
import { adminPage, competitionTabs } from '../admin-layout.js';
import {
  getContest, readContestForm, validateContest, saveContest, isPlatformContest, syncResults, contestPublishProblems, submissionCounts,
} from '../../modules/contests.js';
import { errorPage } from './errors.js';

const page = adminPage;

const notFound = (ctx) => ctx.html(errorPage(ctx, 404), 404);
const idParam = (ctx) => Number(ctx.params.id);
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');

// ---------- панель ----------

export function dashboard(ctx) {
  if (!requireOrganizer(ctx)) return;
  const upcoming = listCompetitions({ phase: 'upcoming' });
  const open = upcoming.filter((c) => registrationInfo(c).open);
  const ongoing = listCompetitions({ phase: 'current' });
  const needResults = listCompetitions({ status: 'FINISHED' });
  const pending = pendingRanks();
  const counts = [
    ['Спортсменов', get('SELECT COUNT(*) AS n FROM athletes').n],
    ['С аккаунтом', get('SELECT COUNT(*) AS n FROM athletes WHERE user_id IS NOT NULL').n],
    ['Регистрация открыта', open.length],
    ['Новых заявок', get("SELECT COUNT(*) AS n FROM registrations WHERE status = 'SUBMITTED'").n],
  ];
  const log = recentAudit(8);

  const toCheck = all(
    `SELECT c.id, c.title, COUNT(*) AS pending FROM submissions s JOIN contest_tasks t ON t.id = s.task_id
       JOIN competitions c ON c.id = t.competition_id WHERE s.score IS NULL GROUP BY c.id ORDER BY MIN(s.created_at)`,
  );
  const todo = [
    ...toCheck.map((c) => html`<li class="todo todo-results"><div><b>Решения ждут проверки:</b> ${c.title}<span class="sub">${countOf(c.pending, ['решение', 'решения', 'решений'])}</span></div>
      <div class="todo-actions"><a class="btn btn-accent btn-sm" href="/admin/competitions/${c.id}/submissions">Проверить</a></div></li>`),
    ...pending.map((p) => html`<li class="todo todo-rank"><div><b>Разряд на проверке:</b> ${fullName(p)}, ${p.rank_name}
        <span class="sub">${p.order_number || 'без номера приказа'}, присвоен ${fmtDate(p.assigned_at)}</span></div>
      <div class="todo-actions">${reviewButtons(ctx, p.id, '/admin')}<a class="btn-link" href="/admin/athletes/${p.athlete_id}">Карточка</a></div></li>`),
    ...needResults.map((c) => html`<li class="todo todo-results"><div><b>Нужны итоги:</b> ${c.title}<span class="sub">завершено ${fmtDate(c.end_date)}</span></div>
      <div class="todo-actions"><a class="btn btn-accent btn-sm" href="/admin/competitions/${c.id}/results">Внести результаты</a></div></li>`),
    ...ongoing.map((c) => html`<li class="todo todo-live"><div><b>Идёт:</b> ${c.title}<span class="sub">${fmtRange(c.start_date, c.end_date)}</span></div>
      <div class="todo-actions"><a class="btn btn-sm" href="/admin/competitions/${c.id}">Управлять</a></div></li>`),
    ...open.map((c) => html`<li class="todo todo-registration"><div><b>Регистрация:</b> ${c.title}
        <span class="sub">${registrationInfo(c).text}, заявок ${c.events.reduce((s, e) => s + e.registered, 0)}</span></div>
      <div class="todo-actions"><a class="btn btn-sm" href="/admin/competitions/${c.id}/participants">Участники</a></div></li>`),
  ];

  const body = html`${ui.pageHead({ eyebrow: 'Операционный центр', title: 'Панель организатора', lede: 'Что требует внимания сегодня.',
      actions: html`<a class="btn btn-accent" href="/admin/competitions/new">Создать соревнование</a> <a class="btn btn-ghost" href="/admin/athletes/new">Добавить спортсмена</a>` })}
    ${firstSteps()}
    <div class="stat-row">${counts.map(([label, n]) => html`<div class="stat-tile"><span class="stat-value">${n}</span><span class="stat-label">${label}</span></div>`)}</div>
    <div class="cabinet-grid">
      <div><h2>Требует внимания</h2>${todo.length ? html`<ul class="todo-list">${todo}</ul>` : ui.empty('Всё сделано.')}</div>
      <aside class="side-panel"><h2 class="h3">Журнал действий</h2>
        ${log.length ? html`<ul class="log">${log.map((l) => html`<li><span class="note-time">${fmtDateTime(l.created_at)}</span>${describeAction(l)}<span class="sub">${l.email || 'система'}</span></li>`)}</ul>` : html`<p class="muted">Пока пусто.</p>`}
      </aside>
    </div>`;
  ctx.html(page(ctx, { title: 'Панель организатора', active: 'dashboard', body }));
}

// Чек-лист запуска: исчезает, когда платформа наполнена.
function firstSteps() {
  const count = (sql) => get(sql).n;
  const site = getSettings();
  const steps = [
    ['Укажите контакты Федерации', 'Адрес, телефон, почта и соцсети появятся в подвале и на странице «О федерации».', '/admin/settings',
      Boolean(site.email || site.phone || site.address)],
    ['Добавьте образовательные организации', 'Без них спортсмены не смогут заполнить профиль и подать заявку.', '/admin/dictionaries#places',
      count('SELECT COUNT(*) AS n FROM organizations') > 0],
    ['Создайте первое соревнование', 'Оно создаётся черновиком и появится на сайте после публикации.', '/admin/competitions/new',
      count('SELECT COUNT(*) AS n FROM competitions') > 0],
    ['Опубликуйте положения и документы', 'Устав, положения о соревнованиях, правила вида спорта.', '/admin/content',
      count("SELECT COUNT(*) AS n FROM documents WHERE url IS NULL OR url <> '/rating/method'") > 0],
    ['Расскажите о запуске в новостях', 'Первая новость появится на главной странице.', '/admin/content',
      count('SELECT COUNT(*) AS n FROM news') > 0],
  ];
  const done = steps.filter((s) => s[3]).length;
  if (done === steps.length) return '';
  return html`<div class="panel steps-panel">
    <div class="section-head compact"><h2 class="h3">Первые шаги</h2><span class="muted small">${done} из ${steps.length}</span></div>
    <div class="progress" aria-hidden="true"><span style="width: ${Math.round((done / steps.length) * 100)}%"></span></div>
    <ol class="steps">${steps.map(([title, hint, href, ok]) => html`<li class="${ok ? 'is-done' : ''}">
      <div><a href="${href}">${title}</a><span class="sub">${hint}</span></div>
      ${ok ? html`<span class="pill pill-good">Готово</span>` : ''}</li>`)}</ol>
  </div>`;
}

function describeAction(l) {
  const map = {
    CREATE: 'Создание', UPDATE: 'Изменение', PUBLISH_RESULTS: 'Итоги опубликованы', ASSIGN_RANK: 'Присвоен разряд',
    RANK_CONFIRMED: 'Разряд подтверждён', RANK_REJECTED: 'Разряд отклонён', REGISTRATION_APPROVED: 'Заявка допущена',
    REGISTRATION_REJECTED: 'Заявка отклонена', REGISTRATION_SUBMITTED: 'Заявка возвращена на рассмотрение',
  };
  const entity = { competition: 'соревнование', athlete: 'спортсмен', athlete_rank: 'разряд', registration: 'заявка', user: 'аккаунт', settings: 'настройки сайта' }[l.entity] || l.entity;
  const ref = l.entity_id ? ` № ${l.entity_id}` : '';
  if (l.action.startsWith('STATUS_')) return html`Статус «${STATUS_LABELS[l.action.slice(7)] || l.action}», ${entity}${ref}`;
  return html`${map[l.action] || l.action}, ${entity}${ref}`;
}

function reviewButtons(ctx, athleteRankId, back) {
  return html`<form method="post" action="/admin/athlete-ranks/${athleteRankId}/review" class="inline-form">${ui.csrf(ctx)}
      <input type="hidden" name="back" value="${back}"><input type="hidden" name="status" value="CONFIRMED">
      <button class="btn btn-sm" type="submit">Подтвердить</button></form>
    <form method="post" action="/admin/athlete-ranks/${athleteRankId}/review" class="inline-form">${ui.csrf(ctx)}
      <input type="hidden" name="back" value="${back}"><input type="hidden" name="status" value="REJECTED">
      <button class="btn btn-ghost btn-sm" type="submit">Отклонить</button></form>`;
}

// ---------- соревнования ----------

export function competitions(ctx) {
  if (!requireOrganizer(ctx)) return;
  const status = STATUS_LABELS[ctx.query.get('status')] ? ctx.query.get('status') : '';
  const list = status ? listCompetitions({ status }) : listCompetitions({ includeDrafts: true });
  list.sort((a, b) => (a.start_date < b.start_date ? 1 : -1));
  const counts = Object.fromEntries(all('SELECT status, COUNT(*) AS n FROM competitions GROUP BY status').map((r) => [r.status, r.n]));
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  const body = html`${ui.pageHead({ title: 'Соревнования', actions: html`<a class="btn btn-accent" href="/admin/competitions/new">Создать соревнование</a>` })}
    ${ui.tabs([{ href: '/admin/competitions', label: 'Все', count: total, active: !status },
      ...Object.keys(STATUS_LABELS).map((s) => ({ href: `/admin/competitions?status=${s}`, label: STATUS_LABELS[s], count: counts[s] || 0, active: s === status }))], 'Статус')}
    ${list.length ? html`<div class="table-wrap"><table class="data">
      <thead><tr><th scope="col">Соревнование</th><th scope="col">Уровень</th><th scope="col">Статус</th><th scope="col" class="num">Заявки</th><th scope="col">Действия</th></tr></thead>
      <tbody>${list.map((c) => html`<tr>
        <td><a href="/admin/competitions/${c.id}">${c.title}</a><span class="sub">${fmtRange(c.start_date, c.end_date)} · ${c.events.map((e) => e.discipline_short).join(', ')}${c.on_platform ? ' · контест на платформе' : ''}</span></td>
        <td>${c.level_short}</td><td>${ui.statusPill(c.status)}</td>
        <td class="num mono">${c.events.reduce((s, e) => s + e.registered, 0)}</td>
        <td><div class="row-actions"><a href="/admin/competitions/${c.id}/participants">Участники</a>${c.on_platform ? html`<a href="/admin/competitions/${c.id}/tasks">Задания</a><a href="/admin/competitions/${c.id}/submissions">Решения</a>` : ''}<a href="/admin/competitions/${c.id}/results">Результаты</a><a href="/competitions/${c.id}">На сайте</a></div></td>
      </tr>`)}</tbody></table></div>` : ui.empty('Соревнований с таким статусом нет.')}`;
  ctx.html(page(ctx, { title: 'Соревнования', active: 'competitions', body }));
}

function competitionForm(ctx, { values, errors = {}, action, submitLabel }) {
  const selected = values.disciplineIds || [];
  return html`<form method="post" action="${action}" class="form panel" novalidate>
    ${ui.csrf(ctx)}
    ${Object.keys(errors).length ? html`<p class="form-error" role="alert">Проверьте поля, отмеченные ниже.</p>` : ''}
    ${ui.field({ label: 'Название', name: 'title', value: values.title, error: errors.title, required: true })}
    <div class="form-grid">
      ${ui.select({ label: 'Уровень соревнования', name: 'level_id', value: values.level_id, error: errors.level_id, required: true, placeholder: 'Выберите',
        options: listLevels().map((l) => ({ value: l.id, label: `${l.name} (B = ${l.base_points})` })) })}
      ${ui.select({ label: 'Формат', name: 'format', value: values.format, error: errors.format, required: true,
        options: Object.entries(FORMAT_LABELS).map(([value, label]) => ({ value, label })) })}
    </div>
    ${ui.checkboxes({ legend: 'Дисциплины', name: 'discipline_ids', values: selected, error: errors.discipline_ids, options: listDisciplines().map((d) => ({ value: d.id, label: d.name })) })}
    <div class="form-grid">
      ${ui.field({ label: 'Дата начала', name: 'start_date', type: 'date', value: values.start_date, error: errors.start_date, required: true })}
      ${ui.field({ label: 'Дата окончания', name: 'end_date', type: 'date', value: values.end_date, error: errors.end_date, required: true })}
      ${ui.field({ label: 'Регистрация с', name: 'reg_start', type: 'date', value: values.reg_start || '', error: errors.reg_start })}
      ${ui.field({ label: 'Регистрация до', name: 'reg_end', type: 'date', value: values.reg_end || '', error: errors.reg_end })}
      ${ui.field({ label: 'Город', name: 'city', value: values.city || '', error: errors.city, hint: 'Для дистанционного формата можно не указывать' })}
      ${ui.field({ label: 'Площадка', name: 'venue', value: values.venue || '' })}
    </div>
    ${ui.textarea({ label: 'Описание', name: 'description', value: values.description, rows: 5, hint: 'Пустая строка начинает новый абзац' })}
    <fieldset class="field"><legend>Условия участия</legend>
      <div class="form-grid">
        ${ui.field({ label: 'Минимальный возраст', name: 'age_min', type: 'number', value: values.age_min ?? '', error: errors.age_min, attrs: 'min="0" max="100"' })}
        ${ui.field({ label: 'Максимальный возраст', name: 'age_max', type: 'number', value: values.age_max ?? '', error: errors.age_max, attrs: 'min="0" max="100"' })}
        ${ui.field({ label: 'Минимум в команде', name: 'min_team_size', type: 'number', value: values.min_team_size ?? 1, error: errors.min_team_size, attrs: 'min="1" max="100"' })}
        ${ui.field({ label: 'Максимум в команде', name: 'max_team_size', type: 'number', value: values.max_team_size ?? 1, error: errors.max_team_size, attrs: 'min="1" max="100"' })}
      </div>
      ${ui.checkbox({ name: 'allow_individual', label: 'Разрешено индивидуальное участие', checked: values.allow_individual ?? 1 })}
      ${ui.select({ label: 'Требуемый разряд (минимум)', name: 'required_rank_id', value: values.required_rank_id || '', placeholder: 'Без требования', options: listRanks().map((r) => ({ value: r.id, label: `${r.name} (${r.short_name})` })) })}
      ${ui.checkboxes({ legend: 'Теги мероприятия', name: 'tag_ids', values: values.tagIds || [], options: listTags().map((x) => ({ value: x.id, label: x.name })) })}
      ${ui.checkboxes({ legend: 'Разрешённые языки программирования', name: 'language_ids', values: values.languageIds || [], options: listLanguages().map((x) => ({ value: x.id, label: x.name })) })}
    </fieldset>
    <fieldset class="field"><legend>Дополнительно</legend>
      ${ui.field({ label: 'Организатор', name: 'organizer_name', value: values.organizer_name || '' })}
      ${ui.textarea({ label: 'Контакты организатора', name: 'organizer_contacts', value: values.organizer_contacts || '', rows: 2 })}
      ${ui.field({ label: 'Призовой фонд', name: 'prize_fund', value: values.prize_fund || '', hint: 'Например: 100 000 ₽ или призы от партнёров' })}
      ${ui.field({ label: 'Ссылка на событие', name: 'event_url', value: values.event_url || '', error: errors.event_url, attrs: 'placeholder="https://..."' })}
      ${ui.field({ label: 'Ссылка на положение', name: 'regulations_url', value: values.regulations_url || '', error: errors.regulations_url, attrs: 'placeholder="https://..."' })}
      ${ui.textarea({ label: 'Правила участия', name: 'rules_text', value: values.rules_text || '', rows: 4 })}
    </fieldset>
    ${ui.checkbox({ name: 'is_external', label: 'Внешнее соревнование', checked: values.is_external, hint: 'Например, Чемпионат России: вносим только своих спортсменов, число участников берём из протокола.' })}
    ${contestFieldset(values.contest || {}, errors)}
    <div class="form-actions"><button class="btn btn-accent" type="submit">${submitLabel}</button></div>
  </form>`;
}

// Блок формы из модуля проведения соревнований (кейс №2).
function contestFieldset(k, errors) {
  return html`<fieldset class="field contest-fieldset">
    <legend>Проведение</legend>
    ${ui.checkbox({ name: 'on_platform', label: 'Проводится на платформе', checked: k.on_platform,
      hint: 'Контест с заданиями: участники отправляют решения на сайте, организатор их проверяет, таблица результатов строится сама. Нужна одна дисциплина.' })}
    <div class="form-grid">
      ${ui.field({ label: 'Время начала', name: 'start_time', type: 'time', value: k.start_time || '10:00', error: errors.start_time })}
      ${ui.field({ label: 'Время окончания', name: 'end_time', type: 'time', value: k.end_time || '14:00', error: errors.end_time })}
    </div>
    ${ui.textarea({ label: 'Правила для участников', name: 'rules', value: k.rules || '', rows: 4, hint: 'Как отправлять решения, как считаются баллы, можно ли отправлять несколько раз.' })}
    ${ui.checkbox({ name: 'auto_status', label: 'Менять статус автоматически по времени', checked: k.auto_status,
      hint: 'Опубликованный контест начнётся во время начала и завершится во время окончания. Без галочки статус меняется кнопками.' })}
    <div class="form-grid">
      ${ui.field({ label: 'Внешняя площадка', name: 'external_platform', value: k.external_platform || '', hint: 'Если соревнование проходит на другой площадке, например Codeforces' })}
      ${ui.field({ label: 'Ссылка на контест', name: 'external_url', value: k.external_url || '', error: errors.external_url, attrs: 'placeholder="https://..."' })}
    </div>
  </fieldset>`;
}

export function newCompetition(ctx) {
  if (!requireOrganizer(ctx)) return;
  const t = todayISO();
  const values = { format: 'OFFLINE', city: 'Махачкала', start_date: addDays(t, 21), end_date: addDays(t, 21), reg_start: t, reg_end: addDays(t, 14), disciplineIds: [] };
  ctx.html(page(ctx, { title: 'Новое соревнование', active: 'competitions', body: html`${ui.pageHead({ crumbs: [['/admin/competitions', 'Соревнования']], title: 'Новое соревнование', lede: 'Соревнование создаётся черновиком. На сайте оно появится после публикации.' })}
    <div class="page-form">${competitionForm(ctx, { values, action: '/admin/competitions', submitLabel: 'Создать черновик' })}</div>` }));
}

export function createCompetition(ctx) {
  if (!requireOrganizer(ctx)) return;
  const values = readCompetitionForm(ctx.form);
  values.contest = readContestForm(ctx.form);
  const errors = { ...validateCompetition(values), ...validateContest(values.contest, values) };
  if (Object.keys(errors).length) {
    return ctx.html(page(ctx, { title: 'Новое соревнование', active: 'competitions', body: html`${ui.pageHead({ crumbs: [['/admin/competitions', 'Соревнования']], title: 'Новое соревнование' })}
      <div class="page-form">${competitionForm(ctx, { values, errors, action: '/admin/competitions', submitLabel: 'Создать черновик' })}</div>` }), 400);
  }
  const id = createComp(values, ctx.user.id);
  saveContest(id, values.contest);
  if (values.contest.on_platform) return ctx.redirect(`/admin/competitions/${id}/tasks`, 'Черновик контеста создан. Добавьте задания, затем опубликуйте его.');
  ctx.redirect(`/admin/competitions/${id}`, 'Черновик создан. Проверьте данные и опубликуйте соревнование.');
}

function statusPanel(ctx, c, events) {
  const transitions = TRANSITIONS[c.status] || [];
  return html`<aside class="side-panel status-panel">
    <h2 class="h3">Статус</h2>
    <p>${ui.statusPill(c.status)}</p>
    ${c.status === 'PUBLISHED' ? html`<p class="muted small">${registrationInfo(c).text}</p>` : ''}
    ${transitions.map((t) => html`<form method="post" action="/admin/competitions/${c.id}/transition" class="transition" ${t.danger ? html`data-confirm="Отменить соревнование? Заявки перестанут действовать."` : ''}>
      ${ui.csrf(ctx)}<input type="hidden" name="action" value="${t.action}">
      <button class="btn ${t.accent ? 'btn-accent' : t.danger ? 'btn-ghost danger' : ''} btn-block" type="submit">${t.label}</button>
      ${t.hint ? html`<p class="hint">${t.hint}</p>` : ''}</form>`)}
    <h2 class="h3">Дисциплины</h2>
    <ul class="plain-list">${events.map((e) => html`<li><b>${e.discipline_short}</b><span class="sub">заявок ${e.registered}, мест внесено ${e.placed}${e.participants_total ? `, по протоколу ${e.participants_total}` : ''}</span></li>`)}</ul>
    ${c.on_platform ? contestSummary(c) : ''}
    <div class="stack-actions">
      <a class="btn btn-ghost btn-sm" href="/admin/competitions/${c.id}/participants">Участники</a>
      <a class="btn btn-ghost btn-sm" href="/admin/competitions/${c.id}/results">Результаты</a>
      ${c.status !== 'DRAFT' ? html`<a class="btn btn-ghost btn-sm" href="/competitions/${c.id}">Открыть на сайте</a>` : ''}
    </div>
  </aside>`;
}

function contestSummary(c) {
  const counts = submissionCounts(c.id);
  const tasks = get('SELECT COUNT(*) AS n FROM contest_tasks WHERE competition_id = ?', c.id).n;
  return html`<h2 class="h3">Контест</h2>
    <ul class="plain-list">
      <li><a href="/admin/competitions/${c.id}/tasks">Задания: ${tasks}</a><span class="sub">${c.start_time}–${c.end_time}${tasks ? '' : ', добавьте хотя бы одно до публикации'}</span></li>
      <li><a href="/admin/competitions/${c.id}/submissions">Решения: ${counts.total}</a><span class="sub">${counts.pending ? `ждут проверки: ${counts.pending}` : 'все проверены'}</span></li>
    </ul>`;
}

function editPage(ctx, c, { values, errors = {} } = {}) {
  const events = eventsOf(c.id);
  const meta = competitionMeta(c.id);
  const v = values || {
    ...c,
    disciplineIds: events.map((e) => e.discipline_id),
    tagIds: meta.tags.map((x) => x.id),
    languageIds: meta.languages.map((x) => x.id),
    contest: getContest(c.id) || {},
  };
  return page(ctx, { title: c.title, active: 'competitions', body: html`${ui.pageHead({ crumbs: [['/admin/competitions', 'Соревнования']], title: c.title })}
    ${competitionTabs(c, 'card')}
    <div class="detail-grid">
      <div>${competitionForm(ctx, { values: v, errors, action: `/admin/competitions/${c.id}`, submitLabel: 'Сохранить изменения' })}</div>
      ${statusPanel(ctx, c, events)}
    </div>` });
}

export function editCompetition(ctx) {
  if (!requireOrganizer(ctx)) return;
  const c = getCompetition(idParam(ctx));
  if (!c) return notFound(ctx);
  ctx.html(editPage(ctx, c));
}

export function updateCompetition(ctx) {
  if (!requireOrganizer(ctx)) return;
  const c = getCompetition(idParam(ctx));
  if (!c) return notFound(ctx);
  const values = readCompetitionForm(ctx.form);
  values.contest = readContestForm(ctx.form);
  const errors = { ...validateCompetition(values), ...validateContest(values.contest, values) };
  if (Object.keys(errors).length) return ctx.html(editPage(ctx, c, { values, errors }), 400);
  const r = updateComp(c.id, values, ctx.user.id);
  if (r.error) return ctx.redirect(`/admin/competitions/${c.id}`, { type: 'error', text: r.error });
  saveContest(c.id, values.contest);
  ctx.redirect(`/admin/competitions/${c.id}`, 'Изменения сохранены.');
}

export function transition(ctx) {
  if (!requireOrganizer(ctx)) return;
  const id = idParam(ctx);
  const action = String(ctx.form.get('action') || '');
  const back = safeNext(ctx.form.get('back'), `/admin/competitions/${id}`);
  if (action === 'publishResults') {
    // Контест: итоговая таблица из проверенных решений переносится в результаты, дальше обычная публикация.
    if (isPlatformContest(getContest(id))) {
      const problems = contestPublishProblems(id);
      if (problems.length) return ctx.redirect(`/admin/competitions/${id}/submissions`, { type: 'error', text: problems.join('. ') });
      syncResults(id);
    }
    const r = publishResults(id, ctx.user);
    if (r.errors) return ctx.redirect(`/admin/competitions/${id}/results`, { type: 'error', text: r.errors.join('. ') });
    return ctx.redirect(`/admin/competitions/${id}/results`, `Итоги опубликованы. Рейтинг пересчитан для ${countOf(r.diff.length, ['спортсмена', 'спортсменов', 'спортсменов'])}, участники получили уведомления.`);
  }
  const r = applyTransition(id, action, ctx.user.id);
  if (r.error) return ctx.redirect(back, { type: 'error', text: r.error });
  ctx.redirect(back, `Готово: статус «${STATUS_LABELS[r.to]}».`);
}

// ---------- участники ----------

export function participants(ctx) {
  if (!requireOrganizer(ctx)) return;
  const c = getCompetition(idParam(ctx));
  if (!c) return notFound(ctx);
  const events = eventsOf(c.id);
  const regs = competitionRegistrations(c.id);
  const quals = qualificationsMap();
  const back = `/admin/competitions/${c.id}/participants`;
  const body = html`${ui.pageHead({ crumbs: [['/admin/competitions', 'Соревнования'], [`/admin/competitions/${c.id}`, c.title]], title: 'Участники',
      lede: html`${c.title}. ${registrationInfo(c).text}.`,
      actions: html`<a class="btn btn-ghost btn-sm" href="/admin/competitions/${c.id}/participants.csv">CSV</a>
        <a class="btn btn-ghost btn-sm" href="/admin/competitions/${c.id}/participants.json">JSON</a>
        <a class="btn btn-ghost btn-sm" href="/admin/competitions/${c.id}/participants.xls">Excel</a>
        <a class="btn btn-sm" href="/admin/competitions/${c.id}/results">К результатам</a>` })}
    ${competitionTabs(c, 'participants')}
    ${events.map((e) => {
      const rows = regs.filter((r) => r.event_id === e.id);
      return html`<div class="section-head"><h2 class="h3">${e.discipline_name}</h2><span class="muted">${countOf(rows.filter((r) => ['SUBMITTED', 'APPROVED'].includes(r.status)).length, ['активная заявка', 'активные заявки', 'активных заявок'])}</span></div>
        ${rows.length ? html`<div class="table-wrap"><table class="data">
          <thead><tr><th scope="col">Спортсмен</th><th scope="col">Организация</th><th scope="col">Квалификация</th><th scope="col">Подана</th><th scope="col">Статус</th><th scope="col">Решение</th></tr></thead>
          <tbody>${rows.map((r) => html`<tr class="${r.status === 'WITHDRAWN' || r.status === 'REJECTED' ? 'is-out' : ''}">
            <td><a href="/admin/athletes/${r.athlete_id}">${fullName(r)}</a><span class="sub">${r.birth_date ? `${ageYears(r.birth_date)} лет` : ''}</span></td>
            <td>${r.organization || '—'}<span class="sub">${r.municipality || ''}</span></td>
            <td>${ui.rankBadge(quals.get(r.athlete_id))}</td>
            <td class="mono small">${fmtDateTime(r.created_at)}</td>
            <td>${ui.regPill(r.status)}</td>
            <td><div class="row-actions">${['SUBMITTED', 'REJECTED'].includes(r.status) ? regButton(ctx, r.id, 'APPROVED', 'Допустить', back) : ''}
              ${['SUBMITTED', 'APPROVED'].includes(r.status) ? regButton(ctx, r.id, 'REJECTED', 'Отклонить', back, true) : ''}</div></td>
          </tr>`)}</tbody></table></div>` : ui.empty('Заявок пока нет.')}`;
    })}`;
  ctx.html(page(ctx, { title: 'Участники', active: 'competitions', body }));
}

const regButton = (ctx, id, status, label, back, ghost = false) =>
  html`<form method="post" action="/admin/registrations/${id}/status" class="inline-form">${ui.csrf(ctx)}
    <input type="hidden" name="status" value="${status}"><input type="hidden" name="back" value="${back}">
    <button class="btn ${ghost ? 'btn-ghost' : ''} btn-sm" type="submit">${label}</button></form>`;

export function registrationStatus(ctx) {
  if (!requireOrganizer(ctx)) return;
  const r = setRegistrationStatus(idParam(ctx), String(ctx.form.get('status') || ''), ctx.user.id);
  const back = safeNext(ctx.form.get('back'), r.competitionId ? `/admin/competitions/${r.competitionId}/participants` : '/admin');
  if (r.error) return ctx.redirect(back, { type: 'error', text: r.error });
  ctx.redirect(back, 'Статус заявки обновлён.');
}

export function participantsCsv(ctx) {
  if (!requireOrganizer(ctx)) return;
  const c = getCompetition(idParam(ctx));
  if (!c) return notFound(ctx);
  const rows = competitionRegistrations(c.id).map((r) => [
    r.discipline_short, r.last_name, r.first_name, r.middle_name, r.birth_date, r.municipality, r.organization, REG_STATUS_LABELS[r.status], r.created_at,
  ]);
  ctx.file(csv([['Дисциплина', 'Фамилия', 'Имя', 'Отчество', 'Дата рождения', 'Населённый пункт', 'Организация', 'Статус заявки', 'Подана (UTC)'], ...rows]),
    `участники-${c.id}.csv`, 'text/csv; charset=utf-8');
}

const participantExportRows = (competitionId) => competitionRegistrations(competitionId).map((r) => ({
  discipline: r.discipline_short,
  lastName: r.last_name,
  firstName: r.first_name,
  middleName: r.middle_name || '',
  birthDate: r.birth_date || '',
  age: r.birth_date ? ageYears(r.birth_date) : null,
  municipality: r.municipality || '',
  organization: r.organization || '',
  qualification: qualificationsMap().get(r.athlete_id)?.shortName || '',
  status: r.status,
  statusLabel: REG_STATUS_LABELS[r.status],
  appliedAt: r.created_at,
  hasAccount: Boolean(r.user_id),
}));

export function participantsJson(ctx) {
  if (!requireOrganizer(ctx)) return;
  const c = getCompetition(idParam(ctx));
  if (!c) return notFound(ctx);
  ctx.file(JSON.stringify({ competition: c.title, exportedAt: new Date().toISOString(), participants: participantExportRows(c.id) }, null, 2),
    `participants-${c.id}.json`, 'application/json; charset=utf-8');
}

// Excel SpreadsheetML 2003 XML: opens in Excel without an XLSX library or dependency.
const xmlEscape = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]);

export function participantsExcel(ctx) {
  if (!requireOrganizer(ctx)) return;
  const c = getCompetition(idParam(ctx));
  if (!c) return notFound(ctx);
  const headers = ['Дисциплина', 'Фамилия', 'Имя', 'Отчество', 'Дата рождения', 'Возраст', 'Населённый пункт', 'Организация', 'Квалификация', 'Статус', 'Статус заявки', 'Подана (UTC)', 'Есть аккаунт'];
  const rows = participantExportRows(c.id).map((r) => [r.discipline, r.lastName, r.firstName, r.middleName, r.birthDate, r.age, r.municipality, r.organization, r.qualification, r.status, r.statusLabel, r.appliedAt, r.hasAccount ? 'Да' : 'Нет']);
  const cell = (v) => `<Cell><Data ss:Type="${typeof v === 'number' ? 'Number' : 'String'}">${xmlEscape(v)}</Data></Cell>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?><?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Участники"><Table><Row>${headers.map(cell).join('')}</Row>${rows.map((r) => `<Row>${r.map(cell).join('')}</Row>`).join('')}</Table></Worksheet></Workbook>`;
  ctx.file(xml, `participants-${c.id}.xls`, 'application/vnd.ms-excel; charset=utf-8');
}

// ---------- результаты ----------

export function results(ctx) {
  if (!requireOrganizer(ctx)) return;
  const c = getCompetition(idParam(ctx));
  if (!c) return notFound(ctx);
  const events = eventsOf(c.id);
  const ev = events.find((e) => e.id === Number(ctx.query.get('event'))) || events[0];
  const cfg = getRatingConfig();
  const head = html`${ui.pageHead({ crumbs: [['/admin/competitions', 'Соревнования'], [`/admin/competitions/${c.id}`, c.title]], title: 'Результаты',
    lede: html`${c.title} · ${fmtRange(c.start_date, c.end_date)} · ${ui.statusPill(c.status)}` })}${competitionTabs(c, 'results')}`;
  // Результаты контеста строятся из проверенных решений: до публикации итогов работаем на вкладке «Решения».
  if (c.on_platform && c.status === 'FINISHED') return ctx.redirect(`/admin/competitions/${c.id}/submissions`);
  const eventTabs = events.length > 1
    ? ui.tabs(events.map((e) => ({ href: `/admin/competitions/${c.id}/results?event=${e.id}`, label: e.discipline_short, count: e.placed, active: e.id === ev.id })), 'Дисциплина')
    : '';

  if (!['FINISHED', 'RESULTS_PUBLISHED'].includes(c.status)) {
    const steps = (TRANSITIONS[c.status] || []).filter((t) => ['publish', 'start', 'finish'].includes(t.action));
    return ctx.html(page(ctx, { title: 'Результаты', active: 'competitions', body: html`${head}
      <div class="panel page-form"><h2 class="h3">Результаты вносятся после завершения соревнования</h2>
        <p>Сейчас статус «${STATUS_LABELS[c.status]}». Переведите соревнование дальше, и здесь откроется таблица ввода.</p>
        ${steps.map((t) => html`<form method="post" action="/admin/competitions/${c.id}/transition" class="inline-form">${ui.csrf(ctx)}
          <input type="hidden" name="action" value="${t.action}"><input type="hidden" name="back" value="/admin/competitions/${c.id}/results">
          <button class="btn" type="submit">${t.label}</button></form>`)}
      </div>` }));
  }

  const rows = resultRows(ev.id);
  const placed = rows.filter((r) => r.place).length;
  const n = ev.participants_total || placed;
  const preview = (place) => (place && n ? c.base_points * kPlace(place, n, cfg) * kField(n, cfg) : null);

  if (c.status === 'RESULTS_PUBLISHED') {
    const changes = all(
      `SELECT rc.*, a.last_name, a.first_name, a.middle_name FROM rating_changes rc JOIN athletes a ON a.id = rc.athlete_id
        WHERE rc.competition_id = ? AND rc.id IN (SELECT MAX(id) FROM rating_changes WHERE competition_id = ? GROUP BY athlete_id)
        ORDER BY rc.rating_after - rc.rating_before DESC`,
      c.id, c.id,
    );
    return ctx.html(page(ctx, { title: 'Результаты', active: 'competitions', body: html`${head}${eventTabs}
      <div class="detail-grid">
        <div>
          <h2 class="h3">${ev.discipline_name}: итоги опубликованы</h2>
          ${resultsReadonly(rows, preview)}
          ${changes.length ? html`<h2 class="h3">Как изменился рейтинг участников</h2><div class="table-wrap"><table class="data">
            <thead><tr><th scope="col">Спортсмен</th><th scope="col" class="num">Было</th><th scope="col" class="num">Стало</th><th scope="col" class="num">Изменение</th><th scope="col" class="num">Место в рейтинге</th></tr></thead>
            <tbody>${changes.map((ch) => html`<tr><td><a href="/athletes/${ch.athlete_id}">${fullName(ch)}</a></td>
              <td class="num mono">${fmt1(ch.rating_before)}</td><td class="num mono">${fmt1(ch.rating_after)}</td>
              <td class="num mono ${ch.rating_after >= ch.rating_before ? 'up' : 'down'}">${signed(ch.rating_after - ch.rating_before)}</td>
              <td class="num mono">${ch.position_before || '—'} → ${ch.position_after || '—'}</td></tr>`)}</tbody></table></div>` : ''}
        </div>
        <aside class="side-panel"><h2 class="h3">Исправление</h2>
          <p class="muted small">Если в итогах ошибка, верните соревнование в статус «Завершено», исправьте места и опубликуйте снова. Рейтинг пересчитается.</p>
          <form method="post" action="/admin/competitions/${c.id}/transition" data-confirm="Скрыть итоги до повторной публикации?">${ui.csrf(ctx)}
            <input type="hidden" name="action" value="reopen"><button class="btn btn-ghost btn-block" type="submit">Исправить итоги</button></form>
          <a class="btn btn-ghost btn-block" href="/competitions/${c.id}">Итоги на сайте</a>
        </aside>
      </div>` }));
  }

  const inList = new Set(rows.map((r) => r.athlete_id));
  const candidates = listAthletes().filter((a) => !inList.has(a.id));
  const problems = validateForPublish(c.id);
  const body = html`${head}${eventTabs}
    <div class="detail-grid">
      <div>
        <form method="post" action="/admin/events/${ev.id}/results" class="results-form">
          ${ui.csrf(ctx)}
          <div class="results-toolbar">
            <h2 class="h3">${ev.discipline_name}</h2>
            <div class="field inline-field">
              <label for="participants_total">Участников по протоколу</label>
              <input class="input input-num" id="participants_total" name="participants_total" type="number" min="1" value="${ev.participants_total || ''}" placeholder="${placed || ''}">
            </div>
          </div>
          <p class="muted small">${c.is_external ? 'Внешний старт: укажите общее число участников из протокола, иначе коэффициенты посчитаются по внесённым строкам.' : 'Число участников считается по внесённым местам. Заполните поле, только если в протоколе участников больше.'}</p>
          ${rows.length ? html`<div class="table-wrap"><table class="data results-table">
            <thead><tr><th scope="col">Спортсмен</th><th scope="col" class="num">Баллы</th><th scope="col" class="num">Место</th><th scope="col">Примечание</th><th scope="col" class="num">P в рейтинг</th></tr></thead>
            <tbody>${rows.map((r) => html`<tr>
              <td><input type="hidden" name="athlete_ids" value="${r.athlete_id}"><a href="/admin/athletes/${r.athlete_id}">${fullName(r)}</a>
                <span class="sub">${r.organization || ''}${r.reg_status ? html` · ${REG_STATUS_LABELS[r.reg_status]}` : ' · внесён организатором'}</span></td>
              <td class="num"><input class="input input-num" name="score_${r.athlete_id}" type="text" inputmode="decimal" value="${r.score ?? ''}" aria-label="Баллы: ${fullName(r)}"></td>
              <td class="num"><input class="input input-num" name="place_${r.athlete_id}" type="number" min="1" value="${r.place ?? ''}" aria-label="Место: ${fullName(r)}"></td>
              <td><input class="input" name="note_${r.athlete_id}" type="text" value="${r.note ?? ''}" aria-label="Примечание: ${fullName(r)}"></td>
              <td class="num mono">${preview(r.place) !== null ? fmt1(preview(r.place)) : html`<span class="muted">—</span>`}</td>
            </tr>`)}</tbody></table></div>` : ui.empty('В этой дисциплине пока нет заявок. Добавьте спортсменов вручную ниже.')}
          <div class="form-actions">
            <button class="btn" type="submit" name="action" value="save">Сохранить</button>
            <button class="btn btn-ghost" type="submit" name="action" value="autoplace">Расставить места по баллам</button>
          </div>
          <p class="hint">Чем больше баллов, тем выше место. Равные баллы делят место: 1, 2, 2, 4. Строки без баллов остаются без места.</p>
        </form>

        <form method="post" action="/admin/events/${ev.id}/results" class="panel add-row">
          ${ui.csrf(ctx)}<input type="hidden" name="action" value="add">
          ${ui.select({ label: 'Добавить спортсмена без заявки', name: 'athlete_id', id: 'add-athlete', placeholder: 'Выберите спортсмена', required: true,
            options: candidates.map((a) => ({ value: a.id, label: `${fullName(a)}${a.municipality ? `, ${a.municipality}` : ''}` })) })}
          <button class="btn btn-ghost btn-sm" type="submit">Добавить строку</button>
          <p class="hint">Нет в списке? <a href="/admin/athletes/new">Создайте спортсмена</a>, аккаунт ему не нужен.</p>
        </form>
      </div>

      <aside class="side-panel">
        <h2 class="h3">Публикация итогов</h2>
        <p class="muted small">После публикации места появятся в карточке соревнования и профилях, рейтинг пересчитается, участники получат уведомления.</p>
        ${problems.length ? html`<ul class="problems">${problems.map((p) => html`<li>${p}</li>`)}</ul>` : html`<p class="ok-note">Проверка пройдена: можно публиковать.</p>`}
        <form method="post" action="/admin/competitions/${c.id}/transition" data-confirm="Опубликовать итоги и пересчитать рейтинг?">${ui.csrf(ctx)}
          <input type="hidden" name="action" value="publishResults">
          <button class="btn btn-accent btn-block" type="submit" ${problems.length ? html`disabled` : ''}>Опубликовать итоги</button></form>
        <h2 class="h3">Как считаются баллы</h2>
        <p class="muted small">P = B × K<sub>м</sub> × K<sub>N</sub>. Уровень «${c.level_name}»: B = ${c.base_points}. ${n ? html`Сейчас N = ${n}, K<sub>N</sub> = ${fmtK(kField(n, cfg))}.` : 'N появится, когда будут расставлены места.'}</p>
      </aside>
    </div>`;
  ctx.html(page(ctx, { title: 'Результаты', active: 'competitions', body }));
}

function resultsReadonly(rows, preview) {
  const placed = rows.filter((r) => r.place);
  if (!placed.length) return ui.empty('В этой дисциплине результатов нет.');
  return html`<div class="table-wrap"><table class="data standings">
    <thead><tr><th scope="col" class="num">Место</th><th scope="col">Спортсмен</th><th scope="col" class="num">Баллы</th><th scope="col" class="num">P в рейтинг</th></tr></thead>
    <tbody>${placed.map((r) => html`<tr><td class="num">${ui.placeMark(r.place)}</td><td><a href="/admin/athletes/${r.athlete_id}">${fullName(r)}</a><span class="sub">${r.organization || ''}</span></td>
      <td class="num mono">${r.score ?? '—'}</td><td class="num mono strong">${fmt1(preview(r.place))}</td></tr>`)}</tbody></table></div>`;
}

export function saveResults(ctx) {
  if (!requireOrganizer(ctx)) return;
  const ev = get(
    'SELECT e.*, c.status, c.id AS competition_id FROM competition_events e JOIN competitions c ON c.id = e.competition_id WHERE e.id = ?',
    idParam(ctx),
  );
  if (!ev) return notFound(ctx);
  const back = `/admin/competitions/${ev.competition_id}/results?event=${ev.id}`;
  if (ev.status !== 'FINISHED') return ctx.redirect(back, { type: 'error', text: 'Результаты можно менять только в статусе «Завершено».' });
  const action = String(ctx.form.get('action') || 'save');
  if (action === 'add') {
    const r = addAthleteToEvent(ev.id, Number(ctx.form.get('athlete_id')));
    return ctx.redirect(back, r.error ? { type: 'error', text: r.error } : 'Строка добавлена. Укажите баллы или место.');
  }
  saveResultsFromForm(ev.id, ctx.form);
  if (ctx.form.has('participants_total')) setParticipantsTotal(ev.id, ctx.form.get('participants_total'));
  if (action === 'autoplace') {
    const n = autoPlace(ev.id);
    return ctx.redirect(back, `Места расставлены по баллам: ${countOf(n, ['участник', 'участника', 'участников'])}.`);
  }
  ctx.redirect(back, 'Результаты сохранены. Это черновик: на сайте они появятся после публикации итогов.');
}

// ---------- спортсмены ----------

export function athletes(ctx) {
  if (!requireOrganizer(ctx)) return;
  const q = String(ctx.query.get('q') || '').trim().slice(0, 60);
  const municipalityId = Number(ctx.query.get('m')) || null;
  const list = listAthletes({ q, municipalityId });
  const quals = qualificationsMap();
  const ratings = computeAll();
  const pending = pendingRanks();
  const body = html`${ui.pageHead({ title: 'Спортсмены', lede: `${countOf(list.length, ['спортсмен', 'спортсмена', 'спортсменов'])}${q || municipalityId ? ' по фильтру' : ' в базе'}.`,
      actions: html`<a class="btn btn-accent" href="/admin/athletes/new">Добавить спортсмена</a>` })}
    ${pending.length ? html`<div class="panel"><h2 class="h3">Разряды на проверке</h2><ul class="todo-list">${pending.map((p) => html`<li class="todo">
      <div><a href="/admin/athletes/${p.athlete_id}">${fullName(p)}</a>: ${p.rank_name}<span class="sub">${p.order_number || ''}, присвоен ${fmtDate(p.assigned_at)}${p.valid_until ? `, до ${fmtDate(p.valid_until)}` : ''}</span></div>
      <div class="todo-actions">${reviewButtons(ctx, p.id, '/admin/athletes')}</div></li>`)}</ul></div>` : ''}
    <form class="filters" method="get" action="/admin/athletes" role="search">
      ${ui.field({ label: 'Поиск', name: 'q', id: 'athlete-q', value: q, attrs: 'placeholder="Фамилия или имя"' })}
      ${ui.select({ label: 'Муниципалитет', name: 'm', id: 'athlete-m', value: municipalityId || '', placeholder: 'Все', autosubmit: true, options: listMunicipalities().map((m) => ({ value: m.id, label: m.name })) })}
      <div class="filters-actions"><button class="btn btn-sm" type="submit">Найти</button>${q || municipalityId ? html`<a class="btn-link" href="/admin/athletes">Сбросить</a>` : ''}</div>
    </form>
    <div class="table-wrap"><table class="data">
      <thead><tr><th scope="col">Спортсмен</th><th scope="col">Муниципалитет</th><th scope="col">Организация</th><th scope="col">Квалификация</th><th scope="col">Аккаунт</th><th scope="col" class="num">Рейтинг</th></tr></thead>
      <tbody>${list.map((a) => html`<tr>
        <td><a href="/admin/athletes/${a.id}">${fullName(a)}</a><span class="sub">${a.birth_date ? `${ageYears(a.birth_date)} лет` : 'возраст не указан'}${a.is_public ? '' : ' · профиль скрыт'}</span></td>
        <td>${a.municipality || '—'}</td><td>${a.organization || '—'}</td><td>${ui.rankBadge(quals.get(a.id))}</td>
        <td class="small">${a.email || html`<span class="muted">без аккаунта</span>`}</td>
        <td class="num mono">${fmt1(ratings.get(a.id)?.total || 0)}</td></tr>`)}</tbody></table></div>`;
  ctx.html(page(ctx, { title: 'Спортсмены', active: 'athletes', body }));
}

function athleteForm(ctx, { values = {}, errors = {} } = {}) {
  return html`<form method="post" action="/admin/athletes" class="form panel page-form" novalidate>
    ${ui.csrf(ctx)}
    <div class="form-grid">
      ${ui.field({ label: 'Фамилия', name: 'last_name', value: values.last_name, error: errors.last_name, required: true })}
      ${ui.field({ label: 'Имя', name: 'first_name', value: values.first_name, error: errors.first_name, required: true })}
      ${ui.field({ label: 'Отчество', name: 'middle_name', value: values.middle_name || '' })}
      ${ui.field({ label: 'Дата рождения', name: 'birth_date', type: 'date', value: values.birth_date || '', error: errors.birth_date })}
    </div>
    ${ui.select({ label: 'Населённый пункт', name: 'municipality_id', value: values.municipality_id, placeholder: 'Не указан', options: listMunicipalities().map((m) => ({ value: m.id, label: m.name })) })}
    ${ui.select({ label: 'Образовательная организация', name: 'organization_id', value: values.organization_id, placeholder: 'Не указана',
      options: listOrganizations().map((o) => ({ value: o.id, label: `${o.name}${o.municipality ? ` (${o.municipality})` : ''}` })) })}
    ${ui.checkboxes({ legend: 'Дисциплины', name: 'discipline_ids', values: values.disciplineIds || [], options: listDisciplines().map((d) => ({ value: d.id, label: d.name })) })}
    ${ui.checkbox({ name: 'is_public', label: 'Публичный профиль', checked: values.is_public ?? 1 })}
    <div class="form-actions"><button class="btn btn-accent" type="submit">Создать спортсмена</button></div>
  </form>`;
}

export function newAthlete(ctx) {
  if (!requireOrganizer(ctx)) return;
  ctx.html(page(ctx, { title: 'Новый спортсмен', active: 'athletes', body: html`${ui.pageHead({ crumbs: [['/admin/athletes', 'Спортсмены']], title: 'Новый спортсмен',
    lede: 'Например, чтобы внести результат внешнего старта. Аккаунт спортсмену не нужен: позже он сможет зарегистрироваться сам.' })}${athleteForm(ctx, { values: { is_public: 1 } })}` }));
}

export function createAthlete(ctx) {
  if (!requireOrganizer(ctx)) return;
  const values = readProfileForm(ctx.form);
  const errors = validateProfile(values, { requirePlaces: false });
  if (Object.keys(errors).length) {
    return ctx.html(page(ctx, { title: 'Новый спортсмен', active: 'athletes', body: html`${ui.pageHead({ crumbs: [['/admin/athletes', 'Спортсмены']], title: 'Новый спортсмен' })}${athleteForm(ctx, { values, errors })}` }), 400);
  }
  const id = createAth(values, null, ctx.user.id);
  ctx.redirect(`/admin/athletes/${id}`, 'Спортсмен добавлен.');
}

function athleteCardPage(ctx, a, { rankValues = {}, rankErrors = {} } = {}) {
  const history = rankHistory(a.id);
  const results = athleteResults(a.id);
  const disciplines = athleteDisciplines(a.id);
  const rating = computeAll().get(a.id);
  return page(ctx, { title: fullName(a), active: 'athletes', body: html`${ui.pageHead({ crumbs: [['/admin/athletes', 'Спортсмены']], title: fullName(a),
      lede: [a.organization, a.municipality, a.birth_date ? `родился ${fmtDate(a.birth_date)}` : null].filter(Boolean).join(' · '),
      actions: html`<a class="btn btn-ghost btn-sm" href="/athletes/${a.id}">Публичный профиль</a>` })}
    <div class="detail-grid">
      <div>
        <dl class="facts">
          <div><dt>Аккаунт</dt><dd>${a.email || 'без аккаунта'}</dd></div>
          <div><dt>Дисциплины</dt><dd>${disciplines.map((d) => d.short_name).join(', ') || 'не указаны'}</dd></div>
          <div><dt>Рейтинг</dt><dd class="mono">${fmt1(rating?.total || 0)}</dd></div>
          <div><dt>Профиль</dt><dd>${a.is_public ? 'публичный' : 'скрыт'}</dd></div>
        </dl>
        <h2 class="h3">Разряды и звания</h2>
        ${history.length ? html`<div class="table-wrap"><table class="data">
          <thead><tr><th scope="col">Разряд</th><th scope="col">Приказ</th><th scope="col">Присвоен</th><th scope="col">Действует до</th><th scope="col">Статус</th><th scope="col">Решение</th></tr></thead>
          <tbody>${history.map((r) => html`<tr><td>${r.rank_name}</td><td class="mono small">${r.order_number || '—'}</td><td>${fmtDate(r.assigned_at)}</td>
            <td>${r.valid_until ? fmtDate(r.valid_until) : 'бессрочно'}</td>
            <td>${ui.chip(RANK_STATUS_LABELS[r.status], r.status === 'CONFIRMED' ? 'chip-good' : r.status === 'REJECTED' ? 'chip-bad' : 'chip-brand')}</td>
            <td><div class="row-actions">${r.status === 'PENDING' ? reviewButtons(ctx, r.id, `/admin/athletes/${a.id}`) : ''}</div></td></tr>`)}</tbody></table></div>` : html`<p class="muted">Разрядов нет.</p>`}
        <h2 class="h3">Опубликованные результаты</h2>
        ${results.length ? html`<ul class="plain-list">${results.map((r) => html`<li><a href="/competitions/${r.competition_id}">${r.title}</a>
          <span class="sub">${fmtDate(r.end_date)} · ${r.discipline_short} · ${r.place}-е место из ${r.participants}</span></li>`)}</ul>` : html`<p class="muted">Результатов нет.</p>`}
      </div>
      <aside class="side-panel">
        <h2 class="h3">Присвоить разряд</h2>
        <p class="muted small">Разряд, внесённый организатором, сразу считается подтверждённым.</p>
        <form method="post" action="/admin/athletes/${a.id}/ranks" class="form" novalidate>${ui.csrf(ctx)}
          ${ui.select({ label: 'Разряд или звание', name: 'rank_id', value: rankValues.rank_id, error: rankErrors.rank_id, placeholder: 'Выберите', required: true,
            options: listRanks().map((r) => ({ value: r.id, label: `${r.name} (+${r.bonus_points})` })) })}
          ${ui.field({ label: 'Дата присвоения', name: 'assigned_at', type: 'date', value: rankValues.assigned_at, error: rankErrors.assigned_at, required: true })}
          ${ui.field({ label: 'Действует до', name: 'valid_until', type: 'date', value: rankValues.valid_until, error: rankErrors.valid_until, hint: 'У званий срока нет' })}
          ${ui.field({ label: 'Номер приказа', name: 'order_number', value: rankValues.order_number, error: rankErrors.order_number, required: true })}
          <button class="btn btn-block" type="submit">Присвоить</button>
        </form>
      </aside>
    </div>` });
}

export function athleteCard(ctx) {
  if (!requireOrganizer(ctx)) return;
  const a = getAthlete(idParam(ctx));
  if (!a) return notFound(ctx);
  ctx.html(athleteCardPage(ctx, a));
}

export function assignRank(ctx) {
  if (!requireOrganizer(ctx)) return;
  const a = getAthlete(idParam(ctx));
  if (!a) return notFound(ctx);
  const r = readRankForm(ctx.form);
  const errors = validateRank(r);
  if (Object.keys(errors).length) return ctx.html(athleteCardPage(ctx, a, { rankValues: r, rankErrors: errors }), 400);
  assignRankFn(a.id, r, ctx.user.id);
  ctx.redirect(`/admin/athletes/${a.id}`, 'Разряд присвоен и уже учитывается в рейтинге.');
}

export function reviewRank(ctx) {
  if (!requireOrganizer(ctx)) return;
  const status = String(ctx.form.get('status') || '');
  const r = reviewRankFn(idParam(ctx), status, ctx.user.id);
  const back = safeNext(ctx.form.get('back'), r.athleteId ? `/admin/athletes/${r.athleteId}` : '/admin');
  if (r.error) return ctx.redirect(back, { type: 'error', text: r.error });
  ctx.redirect(back, status === 'CONFIRMED' ? 'Разряд подтверждён, бонус учтён в рейтинге.' : 'Разряд отклонён, спортсмен получил уведомление.');
}

// ---------- справочники и веса ----------

export function dictionaries(ctx) {
  if (!requireOrganizer(ctx)) return;
  const cfg = getRatingConfig();
  const levels = listLevels();
  const ranks = listRanks();
  const disciplines = listDisciplines();
  const municipalities = listMunicipalities();
  const orgs = listOrganizations();
  const num = (name, value, label, step = '1', min = '0') => html`<input class="input input-num" name="${name}" type="number" step="${step}" min="${min}" value="${value}" aria-label="${label}">`;
  const txt = (name, value, label) => html`<input class="input" name="${name}" type="text" value="${value}" aria-label="${label}">`;

  const body = html`${ui.pageHead({ title: 'Справочники и веса рейтинга', lede: 'Изменения вступают в силу сразу: рейтинг считается из результатов, поэтому пересчитывается при следующем открытии страницы.' })}
    <nav class="toc" aria-label="Разделы"><a href="#levels">Уровни</a><a href="#ranks">Разряды</a><a href="#formula">Параметры формулы</a><a href="#disciplines">Дисциплины</a><a href="#places">Города и организации</a></nav>

    <form method="post" action="/admin/dictionaries/levels" class="panel" id="levels">${ui.csrf(ctx)}
      <h2 class="h3">Уровни соревнований: базовые баллы B</h2>
      <div class="table-wrap"><table class="data compact"><thead><tr><th scope="col">Название</th><th scope="col">Кратко</th><th scope="col" class="num">B</th></tr></thead>
        <tbody>${levels.map((l) => html`<tr><td>${txt(`name_${l.id}`, l.name, `Название уровня: ${l.name}`)}</td><td>${txt(`short_${l.id}`, l.short_name, `Краткое название уровня: ${l.name}`)}</td><td class="num">${num(`points_${l.id}`, l.base_points, `Базовые баллы уровня: ${l.name}`)}</td></tr>`)}</tbody></table></div>
      <button class="btn" type="submit">Сохранить уровни</button>
    </form>
    <form method="post" action="/admin/dictionaries/level-add" class="panel inline-add">${ui.csrf(ctx)}
      ${ui.field({ label: 'Новый уровень', name: 'name', id: 'new-level', required: true })}${ui.field({ label: 'Кратко', name: 'short', id: 'new-level-short' })}
      ${ui.field({ label: 'B', name: 'points', id: 'new-level-points', type: 'number', required: true, attrs: 'min="0"' })}<button class="btn btn-ghost btn-sm" type="submit">Добавить уровень</button></form>

    <form method="post" action="/admin/dictionaries/ranks" class="panel" id="ranks">${ui.csrf(ctx)}
      <h2 class="h3">Разряды и звания: бонус Q</h2>
      <div class="table-wrap"><table class="data compact"><thead><tr><th scope="col">Название</th><th scope="col">Кратко</th><th scope="col" class="num">Q</th></tr></thead>
        <tbody>${ranks.map((r) => html`<tr><td>${txt(`name_${r.id}`, r.name, `Название разряда: ${r.name}`)}</td><td>${txt(`short_${r.id}`, r.short_name, `Краткое название разряда: ${r.name}`)}</td><td class="num">${num(`bonus_${r.id}`, r.bonus_points, `Бонус разряда: ${r.name}`)}</td></tr>`)}</tbody></table></div>
      <button class="btn" type="submit">Сохранить разряды</button>
    </form>

    <form method="post" action="/admin/dictionaries/config" class="panel" id="formula">${ui.csrf(ctx)}
      <h2 class="h3">Параметры формулы</h2>
      <div class="form-grid form-grid-3">
        ${ui.field({ label: 'Версия методики', name: 'version', value: cfg.version })}
        ${ui.field({ label: 'Лучших результатов в зачёте', name: 'topN', type: 'number', value: cfg.topN, attrs: 'min="1" max="20"' })}
        ${ui.field({ label: 'Окно учёта, месяцев', name: 'windowMonths', type: 'number', value: cfg.windowMonths, attrs: 'min="1" max="120"' })}
        ${ui.field({ label: 'Полный вес, месяцев', name: 'fullMonths', type: 'number', value: cfg.fullMonths, attrs: 'min="0" max="120"' })}
        ${ui.field({ label: 'Доля за последнее место', name: 'placeFloor', type: 'number', value: cfg.placeFloor, attrs: 'step="0.01" min="0" max="1"' })}
        ${ui.field({ label: 'Крутизна шкалы мест', name: 'placePower', type: 'number', value: cfg.placePower, attrs: 'step="0.05" min="0.1" max="3"' })}
        ${ui.field({ label: 'Полное поле, участников', name: 'fieldRef', type: 'number', value: cfg.fieldRef, attrs: 'min="2" max="1000"' })}
        ${ui.field({ label: 'K масштаба при 1 участнике', name: 'fieldMin', type: 'number', value: cfg.fieldMin, attrs: 'step="0.05" min="0" max="1"' })}
      </div>
      <button class="btn" type="submit">Сохранить параметры</button>
    </form>

    <form method="post" action="/admin/dictionaries/disciplines" class="panel" id="disciplines">${ui.csrf(ctx)}
      <h2 class="h3">Дисциплины</h2>
      <div class="table-wrap"><table class="data compact"><thead><tr><th scope="col">Полное название</th><th scope="col">Кратко</th></tr></thead>
        <tbody>${disciplines.map((d) => html`<tr><td>${txt(`name_${d.id}`, d.name, `Название дисциплины: ${d.name}`)}</td><td>${txt(`short_${d.id}`, d.short_name, `Краткое название дисциплины: ${d.name}`)}</td></tr>`)}</tbody></table></div>
      <button class="btn" type="submit">Сохранить дисциплины</button>
    </form>
    <form method="post" action="/admin/dictionaries/discipline-add" class="panel inline-add">${ui.csrf(ctx)}
      ${ui.field({ label: 'Новая дисциплина', name: 'name', id: 'new-discipline', required: true })}${ui.field({ label: 'Кратко', name: 'short', id: 'new-discipline-short' })}
      <button class="btn btn-ghost btn-sm" type="submit">Добавить дисциплину</button></form>

    <div class="panel" id="places">
      <h2 class="h3">Населённые пункты</h2>
      <div class="chips">${municipalities.map((m) => ui.chip(m.name))}</div>
      <form method="post" action="/admin/dictionaries/municipality-add" class="inline-add">${ui.csrf(ctx)}
        ${ui.field({ label: 'Название', name: 'name', id: 'new-municipality', required: true })}
        ${ui.select({ label: 'Тип', name: 'kind', id: 'new-municipality-kind', options: Object.entries(MUNICIPALITY_KINDS).map(([value, label]) => ({ value, label })) })}
        <button class="btn btn-ghost btn-sm" type="submit">Добавить</button></form>
      <h2 class="h3">Образовательные организации</h2>
      <div class="table-wrap"><table class="data compact"><thead><tr><th scope="col">Организация</th><th scope="col">Тип</th><th scope="col">Населённый пункт</th></tr></thead>
        <tbody>${orgs.map((o) => html`<tr><td>${o.name}</td><td>${ORG_KINDS[o.kind]}</td><td>${o.municipality || '—'}</td></tr>`)}</tbody></table></div>
      <form method="post" action="/admin/dictionaries/organization-add" class="inline-add">${ui.csrf(ctx)}
        ${ui.field({ label: 'Название', name: 'name', id: 'new-org', required: true })}
        ${ui.select({ label: 'Тип', name: 'kind', id: 'new-org-kind', options: Object.entries(ORG_KINDS).map(([value, label]) => ({ value, label })) })}
        ${ui.select({ label: 'Населённый пункт', name: 'municipality_id', id: 'new-org-m', placeholder: 'Выберите', options: municipalities.map((m) => ({ value: m.id, label: m.name })) })}
        <button class="btn btn-ghost btn-sm" type="submit">Добавить</button></form>
    </div>`;
  ctx.html(page(ctx, { title: 'Справочники', active: 'dictionaries', body }));
}

export function saveDictionary(ctx) {
  if (!requireOrganizer(ctx)) return;
  const f = ctx.form;
  const type = ctx.params.type;
  const text = (k) => String(f.get(k) || '').trim();
  const back = (anchor, message) => ctx.redirect(`/admin/dictionaries#${anchor}`, message);
  switch (type) {
    case 'levels':
      updateLevels(f);
      return back('levels', 'Уровни сохранены. Рейтинг пересчитан по новым весам.');
    case 'level-add':
      if (!text('name') || text('points') === '') return back('levels', { type: 'error', text: 'Укажите название и базовые баллы' });
      addLevel(text('name'), text('short'), text('points'));
      return back('levels', 'Уровень добавлен.');
    case 'ranks':
      updateRanks(f);
      return back('ranks', 'Разряды сохранены. Рейтинг пересчитан.');
    case 'disciplines':
      updateDisciplines(f);
      return back('disciplines', 'Дисциплины сохранены.');
    case 'discipline-add':
      if (!text('name')) return back('disciplines', { type: 'error', text: 'Укажите название дисциплины' });
      addDiscipline(text('name'), text('short'));
      return back('disciplines', 'Дисциплина добавлена.');
    case 'municipality-add': {
      if (!text('name')) return back('places', { type: 'error', text: 'Укажите название' });
      const r = addMunicipality(text('name'), text('kind'));
      return back('places', r.error ? { type: 'error', text: r.error } : 'Населённый пункт добавлен.');
    }
    case 'organization-add':
      if (!text('name')) return back('places', { type: 'error', text: 'Укажите название организации' });
      addOrganization(text('name'), text('kind'), Number(text('municipality_id')) || null);
      return back('places', 'Организация добавлена.');
    case 'config': {
      const n = (k) => Number(String(f.get(k) || '').replace(',', '.'));
      const cfg = {
        version: text('version') || '1.0', topN: Math.round(n('topN')), windowMonths: Math.round(n('windowMonths')), fullMonths: Math.round(n('fullMonths')),
        placeFloor: n('placeFloor'), placePower: n('placePower'), fieldRef: Math.round(n('fieldRef')), fieldMin: n('fieldMin'),
      };
      const ok = cfg.topN >= 1 && cfg.topN <= 20 && cfg.windowMonths >= 1 && cfg.windowMonths <= 120 && cfg.fullMonths >= 0 && cfg.fullMonths <= cfg.windowMonths
        && cfg.placeFloor >= 0 && cfg.placeFloor <= 1 && cfg.placePower >= 0.1 && cfg.placePower <= 3 && cfg.fieldRef >= 2 && cfg.fieldRef <= 1000
        && cfg.fieldMin >= 0 && cfg.fieldMin <= 1;
      if (!ok) return back('formula', { type: 'error', text: 'Проверьте параметры: полный вес не больше окна учёта, доли от 0 до 1.' });
      saveRatingConfig(cfg);
      return back('formula', 'Параметры формулы сохранены. Рейтинг пересчитан.');
    }
    default:
      return notFound(ctx);
  }
}

// ---------- новости и документы ----------

export function content(ctx) {
  if (!requireOrganizer(ctx)) return;
  const news = listNews();
  const docs = listDocuments();
  const del = (action, label) => html`<form method="post" action="${action}" class="inline-form" data-confirm="Удалить «${label}»?">${ui.csrf(ctx)}<button class="btn-link danger" type="submit">Удалить</button></form>`;
  const body = html`${ui.pageHead({ title: 'Новости и документы', lede: 'Простой редактор информационных разделов сайта.' })}
    <div class="two-col">
      <div>
        <form method="post" action="/admin/news" class="form panel">${ui.csrf(ctx)}
          <h2 class="h3">Новая новость</h2>
          ${ui.field({ label: 'Заголовок', name: 'title', required: true })}
          ${ui.field({ label: 'Кратко', name: 'excerpt', required: true, hint: 'Одно предложение для списка новостей' })}
          ${ui.textarea({ label: 'Текст', name: 'body', rows: 6, required: true, hint: 'Пустая строка начинает новый абзац' })}
          <button class="btn btn-accent" type="submit">Опубликовать</button>
        </form>
        <ul class="plain-list">${news.map((n) => html`<li class="row-between"><div><a href="/news/${n.id}">${n.title}</a><span class="sub">${fmtDate(n.published_at)}</span></div>${del(`/admin/news/${n.id}/delete`, n.title)}</li>`)}</ul>
      </div>
      <div>
        <form method="post" action="/admin/documents" class="form panel">${ui.csrf(ctx)}
          <h2 class="h3">Новый документ</h2>
          ${ui.field({ label: 'Название', name: 'title', required: true })}
          ${ui.select({ label: 'Раздел', name: 'category', options: Object.entries(DOC_CATEGORIES).map(([value, label]) => ({ value, label })) })}
          ${ui.field({ label: 'Ссылка', name: 'url', attrs: 'placeholder="https://..."' })}
          ${ui.field({ label: 'Описание', name: 'description' })}
          <button class="btn btn-accent" type="submit">Добавить</button>
        </form>
        <ul class="plain-list">${docs.map((d) => html`<li class="row-between"><div>${d.title}<span class="sub">${DOC_CATEGORIES[d.category]}</span></div>${del(`/admin/documents/${d.id}/delete`, d.title)}</li>`)}</ul>
      </div>
    </div>`;
  ctx.html(page(ctx, { title: 'Новости и документы', active: 'content', body }));
}

export function createNews(ctx) {
  if (!requireOrganizer(ctx)) return;
  const title = String(ctx.form.get('title') || '').trim();
  const excerpt = String(ctx.form.get('excerpt') || '').trim();
  const body = String(ctx.form.get('body') || '').trim();
  if (!title || !excerpt || !body) return ctx.redirect('/admin/content', { type: 'error', text: 'Заполните заголовок, краткое описание и текст.' });
  const id = createNewsFn({ title, excerpt, body });
  ctx.redirect(`/news/${id}`, 'Новость опубликована.');
}

export function deleteNews(ctx) {
  if (!requireOrganizer(ctx)) return;
  deleteNewsFn(idParam(ctx));
  ctx.redirect('/admin/content', 'Новость удалена.');
}

export function createDocument(ctx) {
  if (!requireOrganizer(ctx)) return;
  const title = String(ctx.form.get('title') || '').trim();
  const url = String(ctx.form.get('url') || '').trim();
  if (!title) return ctx.redirect('/admin/content', { type: 'error', text: 'Укажите название документа.' });
  if (url && !/^(https?:\/\/|\/)/.test(url)) return ctx.redirect('/admin/content', { type: 'error', text: 'Ссылка должна начинаться с http:// или https://' });
  createDocFn({ title, category: String(ctx.form.get('category') || ''), url, description: String(ctx.form.get('description') || '').trim() });
  ctx.redirect('/admin/content', 'Документ добавлен.');
}

export function deleteDocument(ctx) {
  if (!requireOrganizer(ctx)) return;
  deleteDocFn(idParam(ctx));
  ctx.redirect('/admin/content', 'Документ удалён.');
}

export function ratingCsv(ctx) {
  if (!requireOrganizer(ctx)) return;
  const board = leaderboard();
  const rows = board.rows.map((r) => [
    r.position, r.athlete.last_name, r.athlete.first_name, r.athlete.middle_name, r.athlete.municipality, r.athlete.organization,
    r.rating.qualification?.shortName || 'б/р', r.rating.counted.length, fmt1(r.rating.total),
  ]);
  ctx.file(csv([['Место', 'Фамилия', 'Имя', 'Отчество', 'Муниципалитет', 'Организация', 'Квалификация', 'Результатов в зачёте', 'Рейтинг'], ...rows]),
    `рейтинг-фсп-рд-${todayISO()}.csv`, 'text/csv; charset=utf-8');
}

// ---------- настройки сайта ----------

function settingsPage(ctx, { values, errors = {} }) {
  const fields = SETTINGS_FIELDS.map((f) => (f.type === 'textarea'
    ? ui.textarea({ label: f.label, name: f.key, value: values[f.key], error: errors[f.key], hint: f.hint, rows: 6 })
    : ui.field({ label: f.label, name: f.key, type: f.type || 'text', value: values[f.key], error: errors[f.key], hint: f.hint, required: f.required })));
  return page(ctx, { title: 'Настройки сайта', active: 'settings', body: html`${ui.pageHead({ title: 'Настройки сайта',
      lede: 'Название и контакты Федерации. Заполненные поля появятся в подвале и на странице «О федерации», пустые не показываются.' })}
    <form method="post" action="/admin/settings" class="form panel page-form" novalidate>${ui.csrf(ctx)}
      ${Object.keys(errors).length ? html`<p class="form-error" role="alert">Проверьте поля, отмеченные ниже.</p>` : ''}
      ${fields[0]}${fields[1]}
      <div class="form-grid">${fields.slice(2)}</div>
      <div class="form-actions"><button class="btn" type="submit">Сохранить</button><a class="btn-link" href="/about">Посмотреть на сайте</a></div>
    </form>` });
}

export function settings(ctx) {
  if (!requireOrganizer(ctx)) return;
  ctx.html(settingsPage(ctx, { values: getSettings() }));
}

export function saveSettings(ctx) {
  if (!requireOrganizer(ctx)) return;
  const values = readSettingsForm(ctx.form);
  const errors = validateSettings(values);
  if (Object.keys(errors).length) return ctx.html(settingsPage(ctx, { values, errors }), 400);
  saveSettingsFn(values, ctx.user.id);
  ctx.redirect('/admin/settings', 'Настройки сохранены.');
}
