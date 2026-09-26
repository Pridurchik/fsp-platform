// Личный кабинет спортсмена.
import { html } from '../../core/html.js';
import { layout } from '../layout.js';
import * as ui from '../ui.js';
import { fmtDate, fmtRange, fmtDateTime } from '../../core/dates.js';
import { fmt1, signed, fullName, countOf } from '../../core/format.js';
import { athleteRegistrations, isProfileComplete, REG_STATUS_LABELS } from '../../modules/registrations.js';
import { athleteRating, lastRatingChange, qualificationFor } from '../../modules/rating/service.js';
import { phaseOf, PHASES } from '../../modules/competitions.js';
import { listNotifications, unreadCount, markAllRead } from '../../modules/notifications.js';
import {
  athleteDisciplines, readProfileForm, validateProfile, updateAthleteProfile, rankHistory, readRankForm, validateRank,
  submitRankRequest, RANK_STATUS_LABELS,
} from '../../modules/athletes.js';
import { listDisciplines, listMunicipalities, listOrganizations, listRanks } from '../../modules/dictionaries.js';
import { athleteContests } from '../../modules/contests.js';
import { requireAthlete, safeNext } from '../guards.js';

function subnav(active) {
  return ui.tabs(
    [
      { href: '/cabinet', label: 'Обзор', active: active === 'overview' },
      { href: '/cabinet/profile', label: 'Профиль и разряд', active: active === 'profile' },
    ],
    'Кабинет',
  );
}

// Контесты на платформе, где спортсмен участвует: отправлено и проверено решений.
function contestSummary(athleteId) {
  const items = athleteContests(athleteId);
  if (!items.length) return ui.empty('Нет участий в контестах на платформе.');
  return html`<div class="table-wrap"><table class="data">
    <thead><tr><th scope="col">Контест</th><th scope="col">Статус</th><th scope="col" class="num">Решения</th></tr></thead>
    <tbody>${items.map((c) => html`<tr>
      <td><a href="/competitions/${c.id}#tasks">${c.title}</a><span class="sub">${fmtRange(c.start_date, c.end_date)} · заданий: ${c.tasks}</span></td>
      <td>${ui.statusPill(c.status)}</td>
      <td class="num small">${c.submitted ? `${c.submitted} отпр., ${c.checked} пров.` : html`<span class="muted">ещё нет</span>`}</td>
    </tr>`)}</tbody></table></div>`;
}

export function overview(ctx) {
  if (!requireAthlete(ctx)) return;
  const a = ctx.athlete;
  const { rating, position, of } = athleteRating(a.id);
  const change = lastRatingChange(a.id);
  const q = qualificationFor(a.id);
  const pending = rankHistory(a.id).filter((r) => r.status === 'PENDING');
  const notes = listNotifications(ctx.user.id, 6);
  const unread = unreadCount(ctx.user.id);
  const regs = athleteRegistrations(a.id);
  const tab = PHASES[ctx.query.get('tab')] ? ctx.query.get('tab') : 'upcoming';
  const byPhase = { upcoming: [], current: [], finished: [] };
  for (const r of regs) {
    const phase = phaseOf(r.competition_status);
    if (byPhase[phase]) byPhase[phase].push(r);
  }
  const shown = byPhase[tab];

  const body = html`<section class="wrap section">
    ${ui.pageHead({ title: fullName(a), actions: html`<a class="btn btn-ghost btn-sm" href="/athletes/${a.id}">Мой публичный профиль</a>` })}
    ${subnav('overview')}
    ${!isProfileComplete(a) ? html`<p class="notice">Профиль заполнен не полностью. Укажите населённый пункт и образовательную организацию, иначе заявку подать не получится. <a href="/cabinet/profile">Заполнить профиль</a></p>` : ''}

    <div class="tiles">
      <div class="tile tile-main">
        <span class="tile-label">Рейтинг</span>
        <span class="tile-value">${fmt1(rating.total)}</span>
        <span class="tile-sub">${position ? `${position}-е место из ${of}` : 'Пока вне рейтинга: нужен опубликованный результат'}</span>
      </div>
      <div class="tile">
        <span class="tile-label">Последнее изменение</span>
        ${change
          ? html`<span class="tile-value ${change.rating_after >= change.rating_before ? 'up' : 'down'}">${signed(change.rating_after - change.rating_before)}</span>
             <span class="tile-sub"><a href="/competitions/${change.competition_id}">${change.competition_title}</a>${change.position_after ? `, место в рейтинге ${change.position_before ? `${change.position_before} → ` : ''}${change.position_after}` : ''}</span>`
          : html`<span class="tile-value muted">0,0</span><span class="tile-sub">Изменений пока не было</span>`}
      </div>
      <div class="tile">
        <span class="tile-label">Квалификация</span>
        <span class="tile-value tile-rank">${ui.rankBadge(q)}</span>
        <span class="tile-sub">${q ? `+${q.bonus} к рейтингу${q.validUntil ? `, до ${fmtDate(q.validUntil)}` : ''}` : 'Нет подтверждённого разряда'}${pending.length ? html`<br><span class="pill pill-brand">На проверке: ${pending.map((p) => p.rank_short).join(', ')}</span>` : ''}</span>
      </div>
    </div>

    <div class="cabinet-grid">
      <div>
        <div class="section-head"><h2>Мои заявки</h2><a href="/competitions">Найти соревнование</a></div>
        ${ui.tabs(Object.entries(PHASES).map(([key, p]) => ({ href: `/cabinet?tab=${key}`, label: p.label, count: byPhase[key].length, active: key === tab })), 'Заявки')}
        ${shown.length ? html`<div class="table-wrap"><table class="data">
          <thead><tr><th scope="col">Соревнование</th><th scope="col">Дисциплина</th><th scope="col">Заявка</th><th scope="col" class="num">Результат</th></tr></thead>
          <tbody>${shown.map((r) => html`<tr>
            <td><a href="/competitions/${r.competition_id}">${r.title}</a><span class="sub">${fmtRange(r.start_date, r.end_date)}</span></td>
            <td>${r.discipline_short}</td>
            <td>${ui.regPill(r.status)}</td>
            <td class="num">${r.competition_status === 'RESULTS_PUBLISHED' && r.place ? html`${ui.placeMark(r.place)} <span class="muted small">из ${r.participants_total || r.placed}</span>` : html`<span class="muted small">${r.competition_status === 'CANCELLED' ? 'отменено' : 'ждём итоги'}</span>`}</td>
          </tr>`)}</tbody></table></div>`
          : ui.empty(tab === 'upcoming' ? 'Заявок на предстоящие соревнования нет.' : 'Здесь пока пусто.', tab === 'upcoming' ? html`<a class="btn btn-accent btn-sm" href="/competitions">Выбрать соревнование</a>` : '')}
        <div class="section-head"><h2>Мои контесты и решения</h2><span class="muted small">Отправки на платформе</span></div>
        ${contestSummary(a.id)}
      </div>
      <aside class="side-panel">
        <div class="section-head compact"><h2 class="h3">Уведомления${unread ? html` <span class="badge">${unread}</span>` : ''}</h2>
          ${unread ? html`<form method="post" action="/cabinet/notifications/read">${ui.csrf(ctx)}<button class="btn-link" type="submit">Прочитано</button></form>` : ''}</div>
        ${notes.length ? html`<ul class="notes">${notes.map((n) => html`<li class="${n.read_at ? '' : 'is-unread'}">
          <span class="note-time">${fmtDateTime(n.created_at)}</span>
          ${n.link ? html`<a href="${n.link}">${n.title}</a>` : html`<b>${n.title}</b>`}
          ${n.body ? html`<p>${n.body}</p>` : ''}</li>`)}</ul>` : html`<p class="muted">Уведомлений нет.</p>`}
      </aside>
    </div>
  </section>`;
  ctx.html(layout(ctx, { title: 'Кабинет', body }));
}

function profilePage(ctx, { values, errors = {}, rankValues = {}, rankErrors = {}, next = '', welcome = false }) {
  const a = ctx.athlete;
  const orgs = listOrganizations();
  const history = rankHistory(a.id);
  return layout(ctx, {
    title: 'Профиль',
    body: html`<section class="wrap section">
      ${ui.pageHead({ title: welcome ? 'Заполните профиль' : 'Профиль и разряд' })}
      ${subnav('profile')}
      <div class="profile-forms">
        <form method="post" action="/cabinet/profile" class="form panel" novalidate>
          ${ui.csrf(ctx)}<input type="hidden" name="next" value="${next}">
          <h2 class="h3">Данные спортсмена</h2>
          <div class="form-grid">
            ${ui.field({ label: 'Фамилия', name: 'last_name', value: values.last_name, error: errors.last_name, required: true })}
            ${ui.field({ label: 'Имя', name: 'first_name', value: values.first_name, error: errors.first_name, required: true })}
            ${ui.field({ label: 'Отчество', name: 'middle_name', value: values.middle_name || '' })}
            ${ui.field({ label: 'Дата рождения', name: 'birth_date', type: 'date', value: values.birth_date || '', error: errors.birth_date })}
          </div>
          ${ui.select({ label: 'Населённый пункт', name: 'municipality_id', value: values.municipality_id, error: errors.municipality_id, required: true, placeholder: 'Выберите',
            options: listMunicipalities().map((m) => ({ value: m.id, label: m.name })) })}
          ${ui.select({ label: 'Образовательная организация', name: 'organization_id', value: values.organization_id, error: errors.organization_id, required: true, placeholder: 'Выберите',
            options: orgs.map((o) => ({ value: o.id, label: `${o.name}${o.municipality ? ` (${o.municipality})` : ''}` })),
            hint: 'Нет вашей школы или вуза? Напишите организатору, он добавит её в справочник.' })}
          ${ui.checkboxes({ legend: 'Дисциплины', name: 'discipline_ids', values: values.disciplineIds || [], options: listDisciplines().map((d) => ({ value: d.id, label: d.name })) })}
          ${ui.checkbox({ name: 'is_public', label: 'Показывать мой профиль всем', checked: values.is_public, hint: 'Если выключить, в рейтинге будет «Профиль скрыт», а баллы останутся.' })}
          <button class="btn btn-accent" type="submit">Сохранить профиль</button>
        </form>

        <div class="panel" id="rank">
          <h2 class="h3">Разряд или звание</h2>
          <p class="muted small">Разряд влияет на рейтинг, поэтому учитывается после проверки организатором. Укажите данные из приказа о присвоении.</p>
          ${history.length ? html`<ul class="plain-list">${history.map((r) => html`<li><b>${r.rank_name}</b> ${ui.chip(RANK_STATUS_LABELS[r.status], r.status === 'CONFIRMED' ? 'chip-good' : r.status === 'REJECTED' ? 'chip-bad' : 'chip-brand')}
            <span class="sub">${r.order_number || ''}, присвоен ${fmtDate(r.assigned_at)}${r.valid_until ? `, до ${fmtDate(r.valid_until)}` : ''}</span></li>`)}</ul>` : html`<p class="muted">Разрядов пока нет.</p>`}
          <form method="post" action="/cabinet/rank" class="form" novalidate>
            ${ui.csrf(ctx)}
            ${ui.select({ label: 'Разряд или звание', name: 'rank_id', value: rankValues.rank_id, error: rankErrors.rank_id, placeholder: 'Выберите', required: true,
              options: listRanks().map((r) => ({ value: r.id, label: r.name })) })}
            <div class="form-grid">
              ${ui.field({ label: 'Дата присвоения', name: 'assigned_at', type: 'date', value: rankValues.assigned_at, error: rankErrors.assigned_at, required: true })}
              ${ui.field({ label: 'Действует до', name: 'valid_until', type: 'date', value: rankValues.valid_until, error: rankErrors.valid_until, hint: 'У званий срока нет' })}
            </div>
            ${ui.field({ label: 'Номер приказа', name: 'order_number', value: rankValues.order_number, error: rankErrors.order_number, required: true, attrs: 'placeholder="№ 123-р"' })}
            <button class="btn btn-ghost" type="submit">Отправить на проверку</button>
          </form>
        </div>
      </div>
    </section>`,
  });
}

function currentProfile(ctx) {
  const a = ctx.athlete;
  return { ...a, disciplineIds: athleteDisciplines(a.id).map((d) => d.id) };
}

export function profileForm(ctx) {
  if (!requireAthlete(ctx)) return;
  ctx.html(profilePage(ctx, {
    values: currentProfile(ctx),
    next: safeNext(ctx.query.get('next'), ''),
    welcome: ctx.query.get('welcome') === '1',
  }));
}

export function saveProfile(ctx) {
  if (!requireAthlete(ctx)) return;
  const values = readProfileForm(ctx.form);
  const next = safeNext(ctx.form.get('next'), '');
  const errors = validateProfile(values);
  if (Object.keys(errors).length) return ctx.html(profilePage(ctx, { values, errors, next }), 400);
  updateAthleteProfile(ctx.athlete.id, values);
  if (next) return ctx.redirect(next, 'Профиль сохранён. Теперь можно подать заявку.');
  ctx.redirect('/cabinet/profile', 'Профиль сохранён.');
}

export function submitRank(ctx) {
  if (!requireAthlete(ctx)) return;
  const r = readRankForm(ctx.form);
  const errors = validateRank(r);
  if (Object.keys(errors).length) {
    return ctx.html(profilePage(ctx, { values: currentProfile(ctx), rankValues: r, rankErrors: errors }), 400);
  }
  submitRankRequest(ctx.athlete.id, r);
  ctx.redirect('/cabinet/profile#rank', 'Разряд отправлен на проверку. Бонус появится в рейтинге после подтверждения.');
}

export function readNotifications(ctx) {
  if (!requireAthlete(ctx)) return;
  markAllRead(ctx.user.id);
  ctx.redirect('/cabinet');
}
