// Общие элементы интерфейса.
import { html, raw } from '../core/html.js';
import { fmt1, fmtK, fmtK2, fullName, shortName } from '../core/format.js';
import { fmtDate, fmtRange, parts, MONTHS_SHORT } from '../core/dates.js';
import { STATUS_LABELS, FORMAT_LABELS, registrationInfo } from '../modules/competitions.js';
import { REG_STATUS_LABELS } from '../modules/registrations.js';

export const csrf = (ctx) => html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;

const STATUS_TONE = {
  DRAFT: 'muted',
  PUBLISHED: 'brand',
  ONGOING: 'live',
  FINISHED: 'warn',
  RESULTS_PUBLISHED: 'good',
  CANCELLED: 'bad',
};
export const statusPill = (status) => html`<span class="pill pill-${STATUS_TONE[status]}">${STATUS_LABELS[status]}</span>`;

const REG_TONE = { SUBMITTED: 'brand', APPROVED: 'good', REJECTED: 'bad', WITHDRAWN: 'muted' };
export const regPill = (status) => html`<span class="pill pill-${REG_TONE[status]}">${REG_STATUS_LABELS[status]}</span>`;

export const chip = (text, extra = '') => html`<span class="chip ${extra}">${text}</span>`;
export const levelChip = (c) => html`<span class="chip chip-level" title="${c.level_name}">${c.level_short}</span>`;
export const disciplineChips = (events) => events.map((e) => chip(e.discipline_short));

export function rankBadge(q) {
  if (!q) return html`<span class="rank rank-none" title="Без разряда">б/р</span>`;
  const kind = (q.kind || 'RANK').toLowerCase();
  return html`<span class="rank rank-${kind}" title="${q.name}">${q.shortName || q.short_name}</span>`;
}

export function placeMark(place) {
  if (!place) return html`<span class="muted">—</span>`;
  if (place <= 3) return html`<span class="medal medal-${place}" title="${place} место">${place}</span>`;
  return html`<span class="place">${place}</span>`;
}

export function athleteName(a, { link = true, viewer = null, short = false } = {}) {
  const visible = a.is_public || (viewer && (viewer.isOrganizer || viewer.athlete?.id === (a.athlete_id ?? a.id)));
  const name = short ? shortName(a) : fullName(a);
  if (!visible) return html`<span class="muted">Профиль скрыт</span>`;
  if (!link) return html`${name}`;
  return html`<a href="/athletes/${a.athlete_id ?? a.id}">${name}</a>`;
}

export function pageHead({ eyebrow = '', title, lede = '', actions = '', crumbs = null }) {
  return html`<header class="page-head">
    ${crumbs ? html`<nav class="crumbs" aria-label="Навигация">${crumbs.map(([href, label]) => html`<a href="${href}">${label}</a><span aria-hidden="true">/</span>`)}</nav>` : ''}
    ${eyebrow ? html`<p class="eyebrow">${eyebrow}</p>` : ''}
    <h1>${title}</h1>
    ${lede ? html`<p class="lede">${lede}</p>` : ''}
    ${actions ? html`<div class="page-actions">${actions}</div>` : ''}
  </header>`;
}

export const empty = (text, action = '') => html`<div class="empty"><p>${text}</p>${action}</div>`;

export function tabs(items, label = 'Разделы') {
  return html`<nav class="tabs" aria-label="${label}">${items.map(
    (t) => html`<a href="${t.href}" class="tab ${t.active ? 'is-active' : ''}" ${t.active ? html`aria-current="page"` : ''}>${t.label}${t.count !== undefined ? html`<span class="tab-count">${t.count}</span>` : ''}</a>`,
  )}</nav>`;
}

export function dateBlock(iso) {
  const { d, m } = parts(iso);
  return html`<div class="date-block" aria-hidden="true"><span class="date-day">${d}</span><span class="date-month">${MONTHS_SHORT[m - 1]}</span></div>`;
}

export function competitionCard(c) {
  const reg = registrationInfo(c);
  const place = c.format === 'ONLINE' ? FORMAT_LABELS.ONLINE : [c.city, FORMAT_LABELS[c.format]].filter(Boolean).join(' · ');
  const registered = c.events.reduce((s, e) => s + e.registered, 0);
  return html`<article class="comp-card">
    ${dateBlock(c.start_date)}
    <div class="comp-body">
      <h3><a href="/competitions/${c.id}">${c.title}</a></h3>
      <p class="comp-meta">${fmtRange(c.start_date, c.end_date)}${c.on_platform ? `, ${c.start_time}–${c.end_time}` : ''} · ${place}</p>
      <div class="chips">${levelChip(c)}${disciplineChips(c.events)}${c.on_platform ? chip('Контест на платформе', 'chip-brand') : ''}</div>
    </div>
    <div class="comp-side">
      ${statusPill(c.status)}
      ${c.status === 'PUBLISHED' ? html`<span class="comp-reg ${reg.open ? 'is-open' : ''}">${reg.text}</span>` : ''}
      ${['PUBLISHED', 'ONGOING'].includes(c.status) ? html`<span class="comp-count">Заявок: ${registered}</span>` : ''}
    </div>
  </article>`;
}

// ---------- формы ----------

export function field({ label, name, value = '', type = 'text', error = '', hint = '', required = false, attrs = '', id = name }) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : '';
  return html`<div class="field ${error ? 'has-error' : ''}">
    <label for="${id}">${label}${required ? html`<span class="req" aria-hidden="true"> *</span>` : ''}</label>
    <input class="input" id="${id}" name="${name}" type="${type}" value="${value ?? ''}" ${required ? raw('required') : ''} ${raw(attrs)} ${error ? raw('aria-invalid="true"') : ''} ${describedBy ? raw(`aria-describedby="${describedBy}"`) : ''}>
    ${hint && !error ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}
    ${error ? html`<p class="field-error" id="${id}-error">${error}</p>` : ''}
  </div>`;
}

export function textarea({ label, name, value = '', error = '', hint = '', rows = 5, required = false, attrs = '', id = name }) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : '';
  return html`<div class="field ${error ? 'has-error' : ''}">
    <label for="${id}">${label}${required ? html`<span class="req" aria-hidden="true"> *</span>` : ''}</label>
    <textarea class="input" id="${id}" name="${name}" rows="${rows}" ${required ? raw('required') : ''} ${raw(attrs)} ${error ? raw('aria-invalid="true"') : ''} ${describedBy ? raw(`aria-describedby="${describedBy}"`) : ''}>${value ?? ''}</textarea>
    ${hint && !error ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}
    ${error ? html`<p class="field-error" id="${id}-error">${error}</p>` : ''}
  </div>`;
}

export function select({ label, name, options, value = '', error = '', placeholder = '', required = false, hint = '', id = name, autosubmit = false }) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : '';
  return html`<div class="field ${error ? 'has-error' : ''}">
    ${label ? html`<label for="${id}">${label}${required ? html`<span class="req" aria-hidden="true"> *</span>` : ''}</label>` : ''}
    <select class="input" id="${id}" name="${name}" ${required ? raw('required') : ''} ${autosubmit ? raw('data-autosubmit') : ''} ${error ? raw('aria-invalid="true"') : ''} ${describedBy ? raw(`aria-describedby="${describedBy}"`) : ''}>
      ${placeholder ? html`<option value="">${placeholder}</option>` : ''}
      ${options.map((o) => html`<option value="${o.value}" ${String(o.value) === String(value ?? '') ? raw('selected') : ''}>${o.label}</option>`)}
    </select>
    ${hint && !error ? html`<p class="hint" id="${id}-hint">${hint}</p>` : ''}
    ${error ? html`<p class="field-error" id="${id}-error">${error}</p>` : ''}
  </div>`;
}

export function checkboxes({ legend, name, options, values = [], error = '' }) {
  const set = new Set(values.map(String));
  const errorId = `${name}-error`;
  return html`<fieldset class="field checks ${error ? 'has-error' : ''}" ${error ? raw(`aria-invalid="true" aria-describedby="${errorId}"`) : ''}>
    <legend>${legend}</legend>
    <div class="check-grid">${options.map(
      (o) => html`<label class="check"><input type="checkbox" name="${name}" value="${o.value}" ${set.has(String(o.value)) ? raw('checked') : ''}> <span>${o.label}</span></label>`,
    )}</div>
    ${error ? html`<p class="field-error" id="${errorId}">${error}</p>` : ''}
  </fieldset>`;
}

export const checkbox = ({ name, label, checked, hint = '' }) =>
  html`<label class="check check-single"><input type="checkbox" name="${name}" value="1" ${checked ? raw('checked') : ''}> <span>${label}${hint ? html`<small class="hint">${hint}</small>` : ''}</span></label>`;

// ---------- рейтинг ----------

const REASONS = { outside: 'вне топ-5', expired: 'старше 24 мес.' };

export function breakdownTable(rating, cfg) {
  const reasons = { ...REASONS, outside: `вне топ-${cfg.topN}`, expired: `старше ${cfg.windowMonths} мес.` };
  const line = (l) => html`<tr class="${l.counted ? '' : 'is-out'}">
    <td><a href="/competitions/${l.competitionId}">${l.competitionTitle}</a>
      <span class="sub">${l.levelShort} · ${l.disciplineName} · ${fmtDate(l.date)}</span></td>
    <td class="num mono nowrap">${l.place} из ${l.participants}</td>
    <td class="num mono nowrap">${l.ageMonths} мес.<span class="show-sm muted"> назад</span></td>
    <td class="num points-cell">${l.counted ? html`<b class="mono">${fmt1(l.points)}</b>` : html`<span class="reason">${reasons[l.reason]}</span>`}
      <span class="calc mono" title="B × Kм × KN × Kt">${l.basePoints} × ${fmtK(l.kPlace)} × ${fmtK(l.kField)} × ${fmtK2(l.kTime)}</span></td>
  </tr>`;
  const q = rating.qualification;
  return html`<div class="table-wrap"><table class="data breakdown">
    <caption class="sr-only">Из чего складывается рейтинг</caption>
    <thead><tr><th scope="col">Соревнование</th><th scope="col" class="num">Место</th><th scope="col" class="num">Давность</th>
      <th scope="col" class="num">Баллы <span class="th-note">B × K<sub>м</sub> × K<sub>N</sub> × K<sub>t</sub></span></th></tr></thead>
    <tbody>
      ${rating.counted.length || rating.excluded.length ? [...rating.counted.map(line), ...rating.excluded.map(line)] : html`<tr><td colspan="4" class="muted">Опубликованных результатов пока нет.</td></tr>`}
      <tr class="qual-row"><td colspan="3">Квалификация: ${q ? q.name : 'без разряда'}
        <span class="sub">${q && q.validUntil ? `бонус Q, действует до ${fmtDate(q.validUntil)}` : 'бонус Q'}</span></td>
        <td class="num"><b class="mono">+${fmt1(rating.bonus)}</b></td></tr>
    </tbody>
    <tfoot><tr><th scope="row" colspan="3">Итого</th><td class="num mono total">${fmt1(rating.total)}</td></tr></tfoot>
  </table></div>`;
}

// Формула в строку: используется на главной и на странице методики.
export function formula(cfg) {
  return html`<div class="formula" aria-label="Формула рейтинга">
    <div class="formula-line"><span class="f-var">R</span><span class="f-op">=</span><span class="f-term">сумма ${cfg.topN} лучших <span class="f-var">P</span> за ${cfg.windowMonths} мес.</span><span class="f-op">+</span><span class="f-term"><span class="f-var">Q</span> за разряд</span></div>
    <div class="formula-line"><span class="f-var">P</span><span class="f-op">=</span><span class="f-var">B</span><span class="f-op">×</span><span class="f-var">K<sub>м</sub></span><span class="f-op">×</span><span class="f-var">K<sub>N</sub></span><span class="f-op">×</span><span class="f-var">K<sub>t</sub></span></div>
  </div>`;
}
