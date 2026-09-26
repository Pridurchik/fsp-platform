// Публичная часть: главная, соревнования, рейтинг, профили, информационные разделы.
import { html, paragraphs } from '../../core/html.js';
import { layout, contactLinks } from '../layout.js';
import { getSettings } from '../../modules/settings.js';
import * as ui from '../ui.js';
import { get, all } from '../../db/index.js';
import { todayISO, fmtDate, fmtRange, fmtMonthYear, addMonths, ageYears, parts, MONTHS_GEN } from '../../core/dates.js';
import { fmt1, fmtK, plural, countOf, fullName, initials, signed } from '../../core/format.js';
import {
  listCompetitions, getCompetition, eventsOf, registrationInfo, PHASES, phaseCounts, FORMAT_LABELS, STATUS_LABELS, competitionMeta,
} from '../../modules/competitions.js';
import {
  applyToEvent, withdrawRegistration, athleteRegistrationsFor, competitionRegistrations, athleteRegistrations, isProfileComplete,
} from '../../modules/registrations.js';
import { publishedResults, athleteResults } from '../../modules/results.js';
import { leaderboard, athleteRating, ratingHistory, getRatingConfig, qualificationFor } from '../../modules/rating/service.js';
import { kPlace, kField } from '../../modules/rating/engine.js';
import { listDisciplines, listLevels, listRanks, listMunicipalities, disciplineByCode, levelByCode, DISCIPLINE_INFO } from '../../modules/dictionaries.js';
import { getAthlete, athleteDisciplines, rankHistory } from '../../modules/athletes.js';
import { listNews, getNews, listDocuments, DOC_CATEGORIES } from '../../modules/content.js';
import { requireAthlete } from '../guards.js';
import { getContest, syncContestStatus } from '../../modules/contests.js';
import { contestBlock, contestPanel } from './contests.js';
import { scheduleList } from './hackathon.js';
import { listSchedule } from '../../modules/schedule.js';
import { canUseChat } from '../../modules/chats.js';
import { myTeamIn, teamMembers, teamsForCompetition } from '../../modules/teams.js';
import { errorPage } from './errors.js';

const notFound = (ctx) => ctx.html(errorPage(ctx, 404), 404);

// ---------- главная ----------

export function home(ctx) {
  const board = leaderboard({ limit: 5 });
  const upcoming = listCompetitions({ phase: 'upcoming' }).filter((c) => c.start_date >= todayISO());
  const current = listCompetitions({ phase: 'current' });
  const recent = listCompetitions({ status: 'RESULTS_PUBLISHED' })
    .sort((a, b) => (a.end_date < b.end_date ? 1 : -1))
    .slice(0, 3);
  const news = listNews(3);
  const featured = upcoming.find((c) => registrationInfo(c).open) || upcoming[0] || current[0] || null;
  // Идущие соревнования стоят первыми в списке стартов, отдельной плашки для них нет.
  const nextStarts = [...current, ...upcoming].filter((c) => c.id !== featured?.id).slice(0, 3);
  const site = getSettings();
  const contacts = contactLinks(site);
  const reg = featured ? registrationInfo(featured) : null;
  const eventDate = featured ? parts(featured.start_date) : null;
  const arrow = html`<svg class="arrow-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.6"/></svg>`;
  const featureLabel = featured?.status === 'ONGOING' ? 'Соревнование идёт' : 'Ближайший старт';

  const body = html`
  <section class="wrap event-feature ${featured ? '' : 'event-feature-empty'}">
    <div class="event-copy">
      <p class="desk-label">${featured ? featureLabel : 'Спортивное программирование'}</p>
      <h1>${featured ? featured.title : 'Соревнования в Дагестане'}</h1>
      ${featured ? html`
        <div class="event-location"><span>${featured.format === 'ONLINE' ? FORMAT_LABELS.ONLINE : [featured.city, featured.venue].filter(Boolean).join(' · ')}</span>${featured.format !== 'ONLINE' ? html`<span>${FORMAT_LABELS[featured.format]}</span>` : ''}</div>
        <p class="event-deadline">${featured.status === 'ONGOING' ? `До ${fmtDate(featured.end_date)}` : reg.text}</p>
        <div class="event-actions"><a class="btn" href="/competitions/${featured.id}">${reg.open ? 'Подробнее и регистрация' : 'О соревновании'}${arrow}</a><a class="text-action" href="/calendar">Календарь сезона</a></div>
      ` : html`<p class="event-deadline">Новые старты появятся здесь после публикации. Пока можно посмотреть итоги прошедших соревнований.</p><a class="btn" href="/competitions?tab=finished">Прошедшие соревнования${arrow}</a>`}
    </div>
    ${featured ? html`<div class="event-poster">
      <div class="poster-top"><span>${featured.events.map((e) => e.discipline_short).join(' / ')}</span><span>${eventDate.y}</span></div>
      <time class="poster-date" datetime="${featured.start_date}"><span class="poster-day">${String(eventDate.d).padStart(2, '0')}</span><span class="poster-month">${MONTHS_GEN[eventDate.m - 1]}</span></time>
      <svg class="poster-art" viewBox="0 0 480 240" fill="none" aria-hidden="true">
        <path d="M-30 216 84 102l48 48L258 24l166 166 80-80" stroke="currentColor" stroke-width="32"/>
        <path d="M-30 216 84 102l48 48L258 24l166 166 80-80" stroke="var(--poster-paper)" stroke-width="2"/>
        <path d="m20 70 34-34-34-34m424 212-34-34 34-34" stroke="currentColor" stroke-width="3"/>
      </svg>
      <div class="poster-bottom"><span>${featured.start_date === featured.end_date ? 'День соревнования' : fmtRange(featured.start_date, featured.end_date)}</span><span class="poster-symbol" aria-hidden="true">{ }</span></div>
    </div>` : ''}
  </section>


  <div class="wrap editorial-grid">
    <section class="schedule-desk">
      <div class="desk-head"><h2>Ближайшие старты</h2><a href="/competitions">Все старты${arrow}</a></div>
      ${nextStarts.length ? html`<div class="agenda-list">${nextStarts.map((c) => {
        const date = parts(c.start_date);
        return html`<article class="agenda-item">
          <time datetime="${c.start_date}"><b>${String(date.d).padStart(2, '0')}</b><span>${MONTHS_GEN[date.m - 1]}</span></time>
          <div><p class="agenda-meta">${c.events.map((e) => e.discipline_short).join(' · ')} / ${c.format === 'ONLINE' ? FORMAT_LABELS.ONLINE : c.city}</p><h3><a href="/competitions/${c.id}">${c.title}</a></h3><p class="agenda-registration ${c.status === 'ONGOING' ? 'is-live' : ''}">${c.status === 'ONGOING' ? `Идёт до ${fmtDate(c.end_date)}` : registrationInfo(c).text}</p></div>
          <a class="agenda-arrow" href="/competitions/${c.id}" aria-label="Подробнее: ${c.title}">${arrow}</a>
        </article>`;
      })}</div>` : html`<div class="desk-empty"><p>Другие старты ещё не объявлены.</p><a href="/calendar">Открыть календарь сезона${arrow}</a></div>`}
    </section>
    <section class="news-desk">
      <div class="desk-head"><h2>Новости Федерации</h2><a href="/news" aria-label="Все новости">${arrow}</a></div>
      ${news.length ? html`<div class="bulletin-list">${news.map((n) => html`<article class="bulletin"><time datetime="${n.published_at}">${fmtDate(n.published_at, { year: false })}</time><h3><a href="/news/${n.id}">${n.title}</a></h3></article>`)}</div>` : html`<p class="muted">Публикации появятся здесь.</p>`}
    </section>
  </div>

  <section class="wrap disciplines-desk" aria-labelledby="disciplines-title">
    <div class="desk-head"><h2 id="disciplines-title">Дисциплины</h2><a href="/documents">Правила вида спорта${arrow}</a></div>
    <div class="discipline-grid">${listDisciplines().map((d) => html`<article class="discipline-item">
      <h3>${d.short_name}</h3>
      <p>${DISCIPLINE_INFO[d.code] || d.name}</p>
      <div class="discipline-links"><a href="/competitions?d=${encodeURIComponent(d.code)}">Старты</a><a href="/rating?d=${encodeURIComponent(d.code)}">Рейтинг</a></div>
    </article>`)}</div>
  </section>

  <div class="wrap editorial-grid results-desk">
    <section>
      <div class="desk-head"><h2>Последние итоги</h2><a href="/competitions?tab=finished">Все результаты${arrow}</a></div>
      ${recent.length ? html`<ul class="result-desk-list">${recent.map((c) => resultItem(c, ctx))}</ul>` : html`<p class="muted">Итоги появятся после завершения первого соревнования.</p>`}
    </section>
    <section class="ranking-desk">
      <div class="desk-head"><h2>Рейтинг спортсменов</h2><a href="/rating" aria-label="Весь рейтинг">${arrow}</a></div>
      ${board.rows.length ? html`<ol class="desk-leaders">${board.rows.map((r) => html`<li><span class="desk-place">${String(r.position).padStart(2, '0')}</span><span class="leader-name">${ui.athleteName(r.athlete, { viewer: ctx, short: true })}<span class="sub">${r.athlete.organization || r.athlete.municipality || ''}</span></span><span class="leader-score">${fmt1(r.rating.total)}</span></li>`)}</ol><a class="rating-method-link" href="/rating/method">Как начисляются баллы${arrow}</a>` : html`<p class="muted">Рейтинг появится после публикации результатов.</p>`}
    </section>
  </div>

  ${ctx.user ? '' : html`<section class="wrap join-desk" aria-labelledby="join-title">
    <div class="join-copy">
      <p class="desk-label">Спортсменам</p>
      <h2 id="join-title">Как принять участие</h2>
      <p>Заявки на соревнования Федерации подаются на сайте. Результаты сразу попадают в профиль спортсмена.</p>
      <a class="btn" href="/register">Зарегистрироваться${arrow}</a>
    </div>
    <ol class="join-steps">
      <li><b>Регистрация</b><span>Создайте аккаунт спортсмена. Если спортсмену нет 18 лет, согласие на обработку данных даёт родитель.</span></li>
      <li><b>Профиль</b><span>Укажите населённый пункт, школу или вуз и дисциплины.</span></li>
      <li><b>Заявка</b><span>Выберите соревнование и подайте заявку в его карточке.</span></li>
      <li><b>Результат</b><span>После публикации итогов баллы появятся в профиле и в рейтинге.</span></li>
    </ol>
  </section>`}

  <section class="wrap about-desk" aria-labelledby="about-title">
    <div class="about-copy">
      <p class="desk-label">О Федерации</p>
      <h2 id="about-title">${site.org_name}</h2>
      ${site.about ? html`<p>${site.about.split(/\n\s*\n/)[0]}</p>` : html`<p>Проводит соревнования по спортивному программированию в республике, ведёт календарь стартов и рейтинг спортсменов.</p>`}
      <a class="text-action" href="/about">Подробнее о федерации</a>
    </div>
    <div class="about-links">
      ${contacts.length ? html`<p class="desk-label">Контакты</p><div class="contact-list">${contacts}</div>` : ''}
      <p class="desk-label">Документы</p>
      <div class="contact-list"><a href="/documents">Положения и регламенты</a><a href="/rating/method">Методика рейтинга</a><a href="/calendar">Календарь сезона</a></div>
    </div>
  </section>`;

  ctx.html(layout(ctx, { body }));
}

function resultItem(c, ctx) {
  const first = publishedResults(c.id)[0];
  const winner = first?.rows[0]?.place === 1 ? first.rows[0] : null;
  return html`<li class="result-item">
    <div>
      <a class="result-title" href="/competitions/${c.id}#results">${c.title}</a>
      <p class="sub">${fmtDate(c.end_date)}${first ? ` · ${first.event.discipline_short}` : ''}</p>
    </div>
    ${winner ? html`<p class="result-winner"><span class="muted">Победитель</span> ${ui.athleteName(winner, { viewer: ctx, short: true, link: false })}</p>` : ''}
  </li>`;
}

function leadersTable(rows, ctx, { showCounted = false, cfg = null } = {}) {
  if (!rows.length) return ui.empty('В рейтинге пока никого нет.');
  return html`<div class="table-wrap"><table class="data standings">
    <thead><tr><th scope="col" class="num">№</th><th scope="col">Спортсмен</th><th scope="col" class="hide-sm">Муниципалитет</th>
      <th scope="col" class="hide-sm">Квалификация</th>${showCounted ? html`<th scope="col" class="num hide-sm">В зачёте</th>` : ''}<th scope="col" class="num">Рейтинг</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr class="${ctx.athlete?.id === r.athlete.id ? 'is-me' : ''}">
      <td class="num">${ui.placeMark(r.position)}</td>
      <td>${ui.athleteName(r.athlete, { viewer: ctx })}<span class="sub">${r.athlete.organization || ''}</span>
        <span class="sub show-sm">${ui.rankBadge(r.rating.qualification)}${r.athlete.municipality || ''}</span></td>
      <td class="hide-sm">${r.athlete.municipality || '—'}</td>
      <td class="hide-sm">${ui.rankBadge(r.rating.qualification)}</td>
      ${showCounted ? html`<td class="num mono hide-sm">${r.rating.counted.length} из ${cfg.topN}</td>` : ''}
      <td class="num mono strong">${fmt1(r.rating.total)}</td></tr>`)}</tbody>
  </table></div>`;
}

// ---------- соревнования ----------

export function competitions(ctx) {
  const tab = PHASES[ctx.query.get('tab')] ? ctx.query.get('tab') : 'upcoming';
  const discipline = disciplineByCode(ctx.query.get('d'));
  const level = levelByCode(ctx.query.get('level'));
  const list = listCompetitions({ phase: tab, disciplineId: discipline?.id, levelId: level?.id });
  const counts = phaseCounts();
  const query = (patch) => {
    const p = new URLSearchParams({ tab, ...(discipline ? { d: discipline.code } : {}), ...(level ? { level: level.code } : {}), ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/competitions?${p}`;
  };

  const body = html`<section class="wrap section">
    ${ui.pageHead({ title: 'Соревнования', lede: 'Старты Федерации по всем дисциплинам. Заявка подаётся в карточке соревнования.' })}
    ${ui.tabs(Object.entries(PHASES).map(([key, p]) => ({ href: query({ tab: key }), label: p.label, count: counts[key] || 0, active: key === tab })), 'Этап соревнований')}
    <form class="filters" method="get" action="/competitions">
      <input type="hidden" name="tab" value="${tab}">
      ${ui.select({ label: 'Дисциплина', name: 'd', id: 'filter-d', value: discipline?.code || '', placeholder: 'Все дисциплины', autosubmit: true,
        options: listDisciplines().map((d) => ({ value: d.code, label: d.short_name })) })}
      ${ui.select({ label: 'Уровень', name: 'level', id: 'filter-level', value: level?.code || '', placeholder: 'Все уровни', autosubmit: true,
        options: listLevels().map((l) => ({ value: l.code, label: l.name })) })}
      <div class="filters-actions"><button class="btn btn-ghost btn-sm" type="submit">Показать</button>
        ${discipline || level ? html`<a class="btn-link" href="/competitions?tab=${tab}">Сбросить</a>` : ''}</div>
    </form>
    <div class="comp-list">${list.length ? list.map(ui.competitionCard) : ui.empty('По этим условиям соревнований нет.')}</div>
  </section>`;
  ctx.html(layout(ctx, { title: 'Соревнования', section: 'competitions', body }));
}

export const CLOSED_PANEL = {
  ONGOING: ['Идёт сейчас', 'Регистрация закрыта. Итоги появятся на этой странице после публикации.'],
  FINISHED: ['Завершено', 'Организатор вносит результаты. После публикации баллы сразу попадут в рейтинг.'],
  RESULTS_PUBLISHED: ['Итоги опубликованы', 'Баллы участников уже учтены в рейтинге Федерации.'],
  CANCELLED: ['Отменено', 'Соревнование отменено, заявки не принимаются.'],
};

export function competition(ctx) {
  let c = getCompetition(Number(ctx.params.id));
  if (!c || (c.status === 'DRAFT' && !ctx.isOrganizer)) return notFound(ctx);
  // Контест на платформе (кейс №2): статус может смениться по времени, задания и таблица рисуются отдельным блоком.
  if (c.on_platform) c = syncContestStatus(c);
  const k = c.on_platform ? getContest(c.id) : null;
  const events = eventsOf(c.id);
  const reg = registrationInfo(c);
  const mine = ctx.athlete ? athleteRegistrationsFor(c.id, ctx.athlete.id) : [];
  const activeMine = mine.filter((r) => ['SUBMITTED', 'APPROVED'].includes(r.status));
  const takenEvents = new Set(activeMine.map((r) => r.event_id));
  const freeEvents = events.filter((e) => !takenEvents.has(e.id));
  const registrations = competitionRegistrations(c.id).filter((r) => ['SUBMITTED', 'APPROVED'].includes(r.status));
  const results = c.status === 'RESULTS_PUBLISHED' && !k ? publishedResults(c.id) : [];
  const place = c.format === 'ONLINE' ? 'Дистанционно' : [c.city, c.venue].filter(Boolean).join(', ');
  const meta = competitionMeta(c.id);
  const myTeam = ctx.athlete ? myTeamIn(c.id, ctx.athlete.id) : null;
  const teamOptions = c.max_team_size > 1 ? teamsForCompetition(c.id, ctx.athlete?.id) : [];

  let panel;
  if (reg.open) {
    if (!ctx.user) {
      const next = encodeURIComponent(`/competitions/${c.id}`);
      panel = html`<p>${reg.text}.</p><p class="muted small">Чтобы подать заявку, войдите или зарегистрируйтесь как спортсмен.</p>
        <div class="stack-actions"><a class="btn btn-accent" href="/register?next=${next}">Зарегистрироваться</a><a class="btn btn-ghost" href="/login?next=${next}">Войти</a></div>`;
    } else if (!ctx.athlete) {
      panel = html`<p>${reg.text}.</p><p class="muted small">Вы вошли как организатор. Заявки подают спортсмены.</p>
        <a class="btn btn-ghost" href="/admin/competitions/${c.id}/participants">Участники</a>`;
    } else if (!isProfileComplete(ctx.athlete)) {
      panel = html`<p>${reg.text}.</p><p class="notice">Чтобы подать заявку, укажите в профиле населённый пункт и образовательную организацию.</p>
        <a class="btn btn-accent" href="/cabinet/profile?next=${encodeURIComponent(`/competitions/${c.id}`)}">Заполнить профиль</a>`;
    } else {
      panel = html`<p>${reg.text}.</p>
        ${freeEvents.length
          ? html`<form method="post" action="/competitions/${c.id}/apply" class="apply-form">${ui.csrf(ctx)}
              ${freeEvents.length > 1
                ? ui.select({ label: 'Дисциплина', name: 'event_id', options: freeEvents.map((e) => ({ value: e.id, label: e.discipline_short })), required: true })
                : html`<input type="hidden" name="event_id" value="${freeEvents[0].id}"><p class="muted small">Дисциплина: ${freeEvents[0].discipline_short}</p>`}
              <button class="btn btn-accent btn-block" type="submit">Подать заявку</button></form>`
          : ''}`;
    }
  } else if (CLOSED_PANEL[c.status]) {
    const [, text] = CLOSED_PANEL[c.status];
    panel = html`<p>${text}</p>${c.status === 'RESULTS_PUBLISHED' ? html`<a class="btn btn-ghost" href="#results">Смотреть итоги</a>` : ''}`;
  } else {
    panel = html`<p>${reg.text}.</p>`;
  }
  let panelTitle = CLOSED_PANEL[c.status]?.[0] || 'Заявка на участие';
  const contestSide = k ? contestPanel(ctx, c) : null;
  if (contestSide) {
    panel = contestSide.body;
    panelTitle = contestSide.title;
  }
  const schedule = listSchedule(c.id);
  const chatBlock = canUseChat(ctx.user, c.id)
    ? html`<div class="my-regs"><h3 class="h4">Чат участников</h3><p class="muted small">Объявления организаторов и общение участников. Пункты расписания приходят сюда и в уведомления.</p>
        <a class="btn btn-block" href="/competitions/${c.id}/chat">Открыть чат</a></div>`
    : mine.some((r) => r.status === 'SUBMITTED')
      ? html`<p class="muted small">Когда организатор одобрит заявку, вас добавят в чат участников.</p>`
      : '';
  const myList = mine.length
    ? html`<div class="my-regs"><h3 class="h4">Ваши заявки</h3>${mine.map((r) => html`<div class="my-reg">
        <span>${r.discipline_short}</span>${ui.regPill(r.status)}
        ${['SUBMITTED', 'APPROVED'].includes(r.status) && reg.open
          ? html`<form method="post" action="/registrations/${r.id}/withdraw" data-confirm="Отозвать заявку?">${ui.csrf(ctx)}<button class="btn-link danger" type="submit">Отозвать</button></form>`
          : ''}</div>`)}</div>`
    : '';

  const body = html`<section class="wrap section">
    ${ui.pageHead({
      crumbs: [['/competitions', 'Соревнования']],
      title: c.title,
      actions: html`<div class="chips">${ui.statusPill(c.status)}${ui.levelChip(c)}${ui.disciplineChips(events)}${c.is_external ? ui.chip('Внешний старт', 'chip-outline') : ''}</div>
        ${ctx.isOrganizer ? html`<a class="btn btn-sm" href="/admin/competitions/${c.id}">Управлять</a>` : ''}`,
    })}
    <div class="detail-grid">
      <div class="detail-main">
        <dl class="facts">
          <div><dt>Даты</dt><dd>${fmtRange(c.start_date, c.end_date)}</dd></div>
          ${k ? html`<div><dt>Время</dt><dd>${k.start_time}–${k.end_time}</dd></div><div><dt>Проведение</dt><dd>На платформе: задания и отправка решений на этой странице</dd></div>` : ''}
          ${c.external_url ? html`<div><dt>Площадка</dt><dd><a href="${c.external_url}" rel="noopener" target="_blank">${c.external_platform || 'Контест на внешней площадке'}</a></dd></div>` : c.external_platform ? html`<div><dt>Площадка</dt><dd>${c.external_platform}</dd></div>` : ''}
          <div><dt>Уровень</dt><dd>${c.level_name} <span class="muted">(B = ${c.base_points})</span></dd></div>
          ${c.organizer_name ? html`<div><dt>Организатор</dt><dd>${c.organizer_name}${c.organizer_contacts ? html`<span class="sub">${c.organizer_contacts}</span>` : ''}</dd></div>` : ''}
          ${c.prize_fund ? html`<div><dt>Призовой фонд</dt><dd>${c.prize_fund}</dd></div>` : ''}
          ${c.age_min != null || c.age_max != null ? html`<div><dt>Возраст</dt><dd>${c.age_min != null ? `от ${c.age_min} лет` : ''}${c.age_min != null && c.age_max != null ? ' · ' : ''}${c.age_max != null ? `до ${c.age_max} лет` : ''}</dd></div>` : ''}
          ${c.min_team_size > 1 || c.max_team_size > 1 ? html`<div><dt>Команда</dt><dd>${c.min_team_size}–${c.max_team_size} участников${c.allow_individual ? ', можно индивидуально' : ''}</dd></div>` : ''}
          ${c.event_url ? html`<div><dt>Ссылка</dt><dd><a href="${c.event_url}" target="_blank" rel="noopener">Открыть страницу мероприятия</a></dd></div>` : ''}
          <div><dt>Дисциплины</dt><dd>${events.map((e) => e.discipline_name).join(', ')}</dd></div>
          <div><dt>Формат</dt><dd>${FORMAT_LABELS[c.format]}</dd></div>
          ${place && c.format !== 'ONLINE' ? html`<div><dt>Место проведения</dt><dd>${place}</dd></div>` : ''}
          <div><dt>Регистрация</dt><dd>${c.reg_start || c.reg_end ? `${c.reg_start ? `с ${fmtDate(c.reg_start)} ` : ''}${c.reg_end ? `до ${fmtDate(c.reg_end)}` : ''}` : 'сроки не указаны'}</dd></div>
          <div><dt>Статус</dt><dd>${STATUS_LABELS[c.status]}</dd></div>
          ${c.max_team_size > 1 ? html`<div><dt>Командный формат</dt><dd>${c.min_team_size}–${c.max_team_size} участников${c.allow_individual ? '; индивидуально тоже можно' : '; индивидуально нельзя'}</dd></div>` : ''}
          ${c.regulations_url ? html`<div><dt>Положение</dt><dd><a href="${c.regulations_url}">Открыть документ</a></dd></div>` : ''}
        </dl>
        ${meta.tags.length ? html`<div class="chips">${meta.tags.map((x) => ui.chip(x.name))}</div>` : ''}
        ${meta.languages.length ? html`<p class="muted small">Разрешённые языки: ${meta.languages.map((x) => x.name).join(', ')}</p>` : ''}
        ${c.rules_text ? html`<div class="page-readable"><h2 class="h3">Правила</h2>${paragraphs(c.rules_text)}</div>` : ''}
        ${c.description ? html`<div class="prose">${paragraphs(c.description)}</div>` : ''}
      </div>
      <aside id="participation" class="side-panel reg-panel ${reg.open || mine.length ? 'is-priority' : ''}" aria-label="${panelTitle}">
        <h2 class="h3">${panelTitle}</h2>
        ${panel}
        ${ctx.athlete && c.max_team_size > 1 && reg.open ? html`<section class="team-controls">
          <h3 class="h4">Команда</h3>
          ${myTeam ? html`<p><b>${myTeam.name}</b> · ${teamMembers(myTeam.id).length}/${c.max_team_size}${myTeam.created_by === ctx.athlete.id ? html`<span class="sub">Капитан</span>` : ''}</p>
            <p class="small">Код для приглашения: <code>${myTeam.invite_code}</code></p>
            <form method="post" action="/competitions/${c.id}/team/leave">${ui.csrf(ctx)}<input type="hidden" name="team_id" value="${myTeam.id}"><button class="btn btn-ghost btn-sm" type="submit">Выйти из команды</button></form>`
            : html`<form method="post" action="/competitions/${c.id}/team" class="form">${ui.csrf(ctx)}
                ${ui.field({ label: 'Название новой команды', name: 'name', required: true, attrs: 'minlength="2" maxlength="60"' })}
                <button class="btn btn-sm" type="submit">Создать команду</button></form>
              <form method="post" action="/competitions/${c.id}/team/join" class="form">${ui.csrf(ctx)}
                ${ui.field({ label: 'Код приглашения', name: 'code', required: true, attrs: 'maxlength="16" autocapitalize="characters"' })}
                <button class="btn btn-ghost btn-sm" type="submit">Вступить по коду</button></form>`}
          ${teamOptions.length ? html`<ul class="plain-list">${teamOptions.map((t) => html`<li>${t.name}<span class="sub">${t.size}/${t.maxSize} участников</span></li>`)}</ul>` : ''}
        </section>` : ''}
        ${myList}
        ${chatBlock}
      </aside>
    </div>

    ${schedule.length ? html`<div class="section-head" id="schedule"><h2>Расписание</h2><span class="muted small">Участники получают уведомление в момент начала каждого пункта</span></div>
      ${scheduleList(schedule)}` : ''}

    ${results.length ? html`<div class="section-head" id="results"><h2>Итоги</h2>${c.is_external ? html`<p class="muted small">Внешний старт: показаны спортсмены Дагестана, число участников взято из протокола.</p>` : ''}</div>
      ${results.map((r) => html`<h3 class="h4">${r.event.discipline_name} <span class="muted">· участников: ${r.participants}</span></h3>
        <div class="table-wrap"><table class="data standings">
          <thead><tr><th scope="col" class="num">Место</th><th scope="col">Спортсмен</th><th scope="col" class="hide-sm">Организация</th>
            <th scope="col" class="num hide-sm">Баллы соревнования</th><th scope="col" class="num">В рейтинг сейчас</th></tr></thead>
          <tbody>${r.rows.map((row) => html`<tr class="${ctx.athlete?.id === row.athlete_id ? 'is-me' : ''}">
            <td class="num">${ui.placeMark(row.place)}</td>
            <td>${ui.athleteName(row, { viewer: ctx })}<span class="sub show-sm">${row.organization || ''}${row.score != null ? ` · ${row.score} б.` : ''}</span></td>
            <td class="hide-sm">${row.organization || '—'}<span class="sub">${row.municipality || ''}</span></td>
            <td class="num mono hide-sm">${row.score ?? '—'}</td>
            <td class="num mono strong">${fmt1(row.points)}</td></tr>`)}</tbody>
        </table></div>`)}` : ''}

    ${k ? contestBlock(ctx, c, k) : ''}

    ${!results.length && registrations.length && !(k && ['FINISHED', 'RESULTS_PUBLISHED'].includes(c.status)) ? html`<div class="section-head"><h2>Участники</h2><span class="muted">${countOf(registrations.length, ['заявка', 'заявки', 'заявок'])}</span></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th scope="col">Спортсмен</th><th scope="col" class="hide-sm">Организация</th><th scope="col">Дисциплина</th><th scope="col">Статус</th></tr></thead>
        <tbody>${registrations.map((r) => html`<tr class="${ctx.athlete?.id === r.athlete_id ? 'is-me' : ''}">
          <td>${ui.athleteName(r, { viewer: ctx })}<span class="sub show-sm">${r.organization || ''}</span></td><td class="hide-sm">${r.organization || '—'}<span class="sub">${r.municipality || ''}</span></td>
          <td>${r.discipline_short}</td><td>${ui.regPill(r.status)}</td></tr>`)}</tbody>
      </table></div>` : ''}
  </section>`;
  ctx.html(layout(ctx, { title: c.title, section: 'competitions', body }));
}

export function apply(ctx) {
  if (!requireAthlete(ctx)) return;
  const id = Number(ctx.params.id);
  const r = applyToEvent(ctx.athlete, Number(ctx.form.get('event_id')));
  if (r.error === 'profile' || r.code === 'birthdate') {
    return ctx.redirect(`/cabinet/profile?next=${encodeURIComponent(`/competitions/${id}`)}`, {
      type: 'info',
      text: r.code === 'birthdate'
        ? 'Для этого соревнования нужна дата рождения. Укажите её в профиле, после сохранения вернём вас к соревнованию.'
        : 'Сначала укажите населённый пункт и образовательную организацию. После сохранения вернём вас к соревнованию.',
    });
  }
  if (r.error) return ctx.redirect(`/competitions/${r.competitionId || id}`, { type: 'error', text: r.error });
  ctx.redirect(`/competitions/${id}`, 'Заявка подана. Она появилась в вашем кабинете, организатор видит её в списке участников.');
}

export function withdraw(ctx) {
  if (!requireAthlete(ctx)) return;
  const r = withdrawRegistration(ctx.athlete, Number(ctx.params.id));
  const back = r.competitionId ? `/competitions/${r.competitionId}` : '/cabinet';
  if (r.error) return ctx.redirect(back, { type: 'error', text: r.error });
  ctx.redirect(back, 'Заявка отозвана.');
}

// ---------- рейтинг ----------

export function rating(ctx) {
  const cfg = getRatingConfig();
  const disciplines = listDisciplines();
  const discipline = disciplineByCode(ctx.query.get('d'));
  const municipalityId = Number(ctx.query.get('m')) || null;
  const q = String(ctx.query.get('q') || '').trim().slice(0, 60);
  const board = leaderboard({ disciplineId: discipline?.id || null, municipalityId, q });
  const tabHref = (code) => {
    const p = new URLSearchParams();
    if (code) p.set('d', code);
    if (municipalityId) p.set('m', municipalityId);
    if (q) p.set('q', q);
    return `/rating${p.toString() ? `?${p}` : ''}`;
  };

  const body = html`<section class="wrap section">
    ${ui.pageHead({
      eyebrow: `Рейтинг на ${fmtDate(board.asOf)}`,
      title: 'Рейтинг спортсменов Республики Дагестан',
      lede: `Сумма ${cfg.topN} лучших результатов за ${cfg.windowMonths} месяца плюс бонус за подтверждённый разряд. Нажмите на спортсмена, чтобы увидеть, за что начислен каждый балл.`,
      actions: html`<a class="btn btn-ghost btn-sm" href="/rating/method">Как считается рейтинг</a>${ctx.isOrganizer ? html` <a class="btn btn-ghost btn-sm" href="/admin/rating.csv">Скачать CSV</a>` : ''}`,
    })}
    ${ui.tabs([{ href: tabHref(null), label: 'Абсолютный', active: !discipline }, ...disciplines.map((d) => ({ href: tabHref(d.code), label: d.short_name, active: discipline?.id === d.id }))], 'Дисциплина')}
    <form class="filters" method="get" action="/rating" role="search">
      ${discipline ? html`<input type="hidden" name="d" value="${discipline.code}">` : ''}
      ${ui.select({ label: 'Муниципалитет', name: 'm', id: 'filter-m', value: municipalityId || '', placeholder: 'Все муниципалитеты', autosubmit: true,
        options: listMunicipalities().map((m) => ({ value: m.id, label: m.name })) })}
      ${ui.field({ label: 'Поиск по имени', name: 'q', id: 'filter-q', value: q, attrs: 'placeholder="Фамилия или имя" autocomplete="off"' })}
      <div class="filters-actions"><button class="btn btn-sm" type="submit">Найти</button>
        ${municipalityId || q ? html`<a class="btn-link" href="${discipline ? `/rating?d=${discipline.code}` : '/rating'}">Сбросить</a>` : ''}</div>
    </form>
    <p class="muted small">${countOf(board.total, ['спортсмен', 'спортсмена', 'спортсменов'])} в рейтинге${discipline ? ` по дисциплине «${discipline.short_name}»` : ''}${municipalityId || q ? `, показано ${board.rows.length}` : ''}.</p>
    ${leadersTable(board.rows, ctx, { showCounted: true, cfg })}
  </section>`;
  ctx.html(layout(ctx, { title: 'Рейтинг', section: 'rating', body }));
}

export function method(ctx) {
  const cfg = getRatingConfig();
  const levels = listLevels();
  const ranks = listRanks();
  const leader = leaderboard({ limit: 1 }).rows[0];
  const placeExamples = [1, 2, 3, 5, 10, 25, 50];
  const fieldExamples = [1, 5, 10, 20, 30, 50];

  const body = html`<section class="wrap section page-readable">
    ${ui.pageHead({
      eyebrow: `Методика рейтинга, версия ${cfg.version}`,
      title: 'Как считается рейтинг',
      lede: 'Рейтинг показывает текущий уровень спортсмена по его выступлениям и спортивной квалификации. Это внутренний рейтинг Федерации: он не заменяет разряды ЕВСК и решения спортивных органов.',
    })}
    ${ui.formula(cfg)}
    <div class="prose">
      <p>Каждый результат превращается в баллы <b>P</b>. В рейтинг идут ${cfg.topN} лучших за последние ${cfg.windowMonths} месяца, к ним прибавляется бонус <b>Q</b> за подтверждённый разряд или звание. Рейтинг считается отдельно по каждой дисциплине и в общем зачёте.</p>
    </div>

    <h2>B: уровень соревнования</h2>
    <p class="muted">Чемпионат России принят за 100 %, остальные уровни получают долю от него.</p>
    <div class="table-wrap"><table class="data compact"><thead><tr><th scope="col">Уровень</th><th scope="col" class="num">Базовые баллы B</th></tr></thead>
      <tbody>${levels.map((l) => html`<tr><td>${l.name}</td><td class="num mono strong">${l.base_points}</td></tr>`)}</tbody></table></div>

    <h2>K<sub>м</sub>: занятое место</h2>
    <p>K<sub>м</sub> = 1 − ${fmtK(1 - cfg.placeFloor).replace(/0+$/, '')} × √((m − 1) / N), где m это место, N это число участников. Шкала крутая наверху: разница между первым и третьим местом больше, чем между тридцатым и тридцать вторым. Последнее место получает около ${Math.round(cfg.placeFloor * 100)} %, потому что попасть в финал сильного старта уже результат.</p>
    <div class="table-wrap"><table class="data compact"><caption>При 50 участниках</caption>
      <thead><tr><th scope="col">Место</th>${placeExamples.map((m) => html`<th scope="col" class="num">${m}</th>`)}</tr></thead>
      <tbody><tr><th scope="row">K<sub>м</sub></th>${placeExamples.map((m) => html`<td class="num mono">${fmtK(kPlace(m, 50, cfg))}</td>`)}</tr></tbody></table></div>

    <h2>K<sub>N</sub>: число участников</h2>
    <p>Победа среди пятерых весит меньше, чем среди пятидесяти, но не обнуляется. Каждое удвоение числа участников добавляет одинаковую долю, от ${fmtK(cfg.fieldMin).replace(/0+$/, '')} до 1 при ${cfg.fieldRef} участниках и больше. Для внешних стартов, где мы вносим только своих спортсменов, N берётся из официального протокола.</p>
    <div class="table-wrap"><table class="data compact">
      <thead><tr><th scope="col">Участников</th>${fieldExamples.map((n) => html`<th scope="col" class="num">${n}</th>`)}</tr></thead>
      <tbody><tr><th scope="row">K<sub>N</sub></th>${fieldExamples.map((n) => html`<td class="num mono">${fmtK(kField(n, cfg))}</td>`)}</tr></tbody></table></div>

    <h2>K<sub>t</sub>: давность результата</h2>
    <p>Первые ${cfg.fullMonths} месяцев результат весит полностью, затем его вес плавно уменьшается и к ${cfg.windowMonths} месяцам становится нулевым. Плавный спад лучше обрыва: рейтинг не падает скачком в день годовщины старта.</p>

    <h2>Q: спортивная квалификация</h2>
    <p>Бонус начисляется только за разряд, подтверждённый организатором, и только пока он действует. Бонус умеренный: разряд получен за результаты, которые уже есть в рейтинге, и большой бонус посчитал бы их дважды.</p>
    <div class="table-wrap"><table class="data compact"><thead><tr><th scope="col">Разряд или звание</th><th scope="col" class="num">Бонус Q</th></tr></thead>
      <tbody><tr><td>Без разряда</td><td class="num mono">0</td></tr>${ranks.map((r) => html`<tr><td>${r.name}</td><td class="num mono strong">${r.bonus_points}</td></tr>`)}</tbody></table></div>

    <h2>Частые вопросы</h2>
    <dl class="faq">
      <div><dt>Почему в зачёт идут только ${cfg.topN} лучших результатов?</dt><dd>Так рейтинг ценит уровень, а не количество стартов. Спортсмен из района, который не может ездить на каждый турнир, не проигрывает тому, кто выступает каждую неделю.</dd></div>
      <div><dt>Можно ли набрать рейтинг на маленьких турнирах?</dt><dd>Только частично. Небольшое число участников снижает K<sub>N</sub>, а в зачёт идут лишь ${cfg.topN} результатов. Восемь побед на школьных турнирах по шесть человек дают меньше, чем одно призовое место на Чемпионате республики.</dd></div>
      <div><dt>Что если места поделены?</dt><dd>Спортсмены с одинаковым местом получают одинаковые баллы, следующий получает место с пропуском: 1, 2, 3, 3, 5.</dd></div>
      <div><dt>Почему старый результат перестал учитываться?</dt><dd>Рейтинг показывает текущую форму. Результаты старше ${cfg.windowMonths} месяцев остаются в истории спортсмена, но не дают баллов.</dd></div>
      <div><dt>Как проверить свой рейтинг?</dt><dd>Откройте свой профиль: там расписано, какие старты вошли в зачёт, с какими коэффициентами и почему остальные не вошли.${leader ? html` Пример: <a href="/athletes/${leader.athlete.id}">профиль лидера рейтинга</a>.` : ''}</dd></div>
    </dl>
  </section>`;
  ctx.html(layout(ctx, { title: 'Методика рейтинга', section: 'rating', body }));
}

// ---------- профиль спортсмена ----------

export function athlete(ctx) {
  const a = getAthlete(Number(ctx.params.id));
  if (!a) return notFound(ctx);
  const own = ctx.athlete?.id === a.id;
  if (!a.is_public && !own && !ctx.isOrganizer) {
    return ctx.html(layout(ctx, { title: 'Профиль скрыт', body: html`<section class="wrap page-narrow section">
      <h1>Спортсмен скрыл профиль</h1><p class="lede">Результаты этого спортсмена учитываются в рейтинге, но имя и история видны только ему и организаторам.</p>
      <a class="btn" href="/rating">К рейтингу</a></section>` }));
  }
  const cfg = getRatingConfig();
  const disciplines = athleteDisciplines(a.id);
  const results = athleteResults(a.id);
  const resultDisciplines = [...new Map(results.map((r) => [r.discipline_short, r])).keys()];
  const discipline = disciplineByCode(ctx.query.get('d'));
  const abs = athleteRating(a.id);
  const view = discipline ? athleteRating(a.id, { disciplineId: discipline.id }) : abs;
  const history = ratingHistory(a.id);
  const yearChange = history[history.length - 1].total - history[0].total;
  const ranks = rankHistory(a.id).filter((r) => r.status === 'CONFIRMED');
  const q = qualificationFor(a.id);
  const regs = own || ctx.isOrganizer ? athleteRegistrations(a.id).filter((r) => ['PUBLISHED', 'ONGOING'].includes(r.competition_status) && ['SUBMITTED', 'APPROVED'].includes(r.status)) : [];
  const age = ageYears(a.birth_date);
  const allDisciplines = listDisciplines();
  const tabItems = [{ href: `/athletes/${a.id}`, label: 'Общий зачёт', active: !discipline }];
  for (const d of allDisciplines) {
    if (resultDisciplines.includes(d.short_name)) tabItems.push({ href: `/athletes/${a.id}?d=${d.code}`, label: d.short_name, active: discipline?.id === d.id });
  }

  const body = html`<section class="wrap section">
    <nav class="crumbs" aria-label="Навигация"><a href="/rating">Рейтинг</a><span aria-hidden="true">/</span></nav>
    <div class="profile-head">
      <div class="avatar" aria-hidden="true">${initials(a)}</div>
      <div class="profile-id">
        <h1>${fullName(a)}</h1>
        <p class="profile-meta">${[a.organization, a.municipality, age ? `${age} ${plural(age, ['год', 'года', 'лет'])}` : null].filter(Boolean).join(' · ')}</p>
        <div class="chips">${ui.rankBadge(q)}${disciplines.map((d) => ui.chip(d.short_name))}${!a.is_public ? ui.chip('Профиль скрыт от других', 'chip-outline') : ''}</div>
      </div>
      <div class="profile-score">
        <span class="score-label">Рейтинг</span>
        <span class="score-value">${fmt1(abs.rating.total)}</span>
        <span class="score-pos">${abs.position ? `${abs.position}-е место из ${abs.of}` : 'пока вне рейтинга'}</span>
      </div>
    </div>

    <div class="profile-grid">
      <div>
        <div class="section-head"><h2>Из чего складывается рейтинг</h2></div>
        ${tabItems.length > 1 ? ui.tabs(tabItems, 'Зачёт') : ''}
        ${discipline ? html`<p class="muted small">В зачёте «${discipline.short_name}»: ${fmt1(view.rating.total)}${view.position ? `, ${view.position}-е место из ${view.of}` : ''}.</p>` : ''}
        ${ui.breakdownTable(view.rating, cfg)}
        <p class="muted small">P = B × K<sub>м</sub> × K<sub>N</sub> × K<sub>t</sub>. В рейтинг идут ${cfg.topN} лучших результатов за ${cfg.windowMonths} месяца. <a href="/rating/method">Подробнее о методике</a></p>
      </div>
      <aside class="side-panel">
        <h2 class="h3">Сводка</h2>
        <dl class="summary">
          <div><dt>Место в рейтинге</dt><dd>${abs.position ? `${abs.position} из ${abs.of}` : '—'}</dd></div>
          <div><dt>Результатов в зачёте</dt><dd>${abs.rating.counted.length} из ${cfg.topN}</dd></div>
          <div><dt>Стартов всего</dt><dd>${results.length}</dd></div>
          <div><dt>Призовых мест</dt><dd>${results.filter((r) => r.place && r.place <= 3).length}</dd></div>
          <div><dt>За 12 месяцев</dt><dd class="${yearChange > 0 ? 'up' : yearChange < 0 ? 'down' : ''}">${signed(yearChange)}</dd></div>
        </dl>
        ${ranks.length ? html`<h2 class="h3">Разряды</h2><ul class="plain-list">${ranks.map((r) => html`<li><b>${r.rank_name}</b>
          <span class="sub">присвоен ${fmtDate(r.assigned_at)}${r.valid_until ? `, до ${fmtDate(r.valid_until)}` : ''}${r.valid_until && r.valid_until < todayISO() ? ' (истёк)' : ''}</span></li>`)}</ul>` : ''}
        ${regs.length ? html`<h2 class="h3">Заявки</h2><ul class="plain-list">${regs.map((r) => html`<li><a href="/competitions/${r.competition_id}">${r.title}</a><span class="sub">${fmtRange(r.start_date, r.end_date)} · ${r.discipline_short}</span></li>`)}</ul>` : ''}
      </aside>
    </div>

    <div class="section-head"><h2>История выступлений</h2><span class="muted">${countOf(results.length, ['старт', 'старта', 'стартов'])}</span></div>
    ${results.length ? html`<div class="table-wrap"><table class="data">
      <thead><tr><th scope="col" class="hide-sm">Дата</th><th scope="col">Соревнование</th><th scope="col" class="hide-sm">Дисциплина</th><th scope="col" class="num">Место</th></tr></thead>
      <tbody>${results.map((r) => html`<tr><td class="mono nowrap hide-sm">${fmtDate(r.end_date)}</td>
        <td><a href="/competitions/${r.competition_id}">${r.title}</a><span class="sub">${r.level_short}<span class="show-sm"> · ${r.discipline_short} · ${fmtDate(r.end_date)}</span></span></td>
        <td class="hide-sm">${r.discipline_short}</td><td class="num nowrap">${ui.placeMark(r.place)} <span class="muted small">из ${r.participants}</span></td></tr>`)}</tbody>
    </table></div>` : ui.empty('Опубликованных результатов пока нет.')}
  </section>`;
  ctx.html(layout(ctx, { title: fullName(a), section: 'rating', body }));
}

// ---------- календарь и информационные разделы ----------

export function calendar(ctx) {
  const today = todayISO();
  const from = addMonths(today, -3);
  const list = listCompetitions({}).filter((c) => c.end_date >= from).sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const groups = new Map();
  for (const c of list) {
    const key = c.start_date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const body = html`<section class="wrap section">
    ${ui.pageHead({ title: 'Календарь соревнований', lede: 'Прошедшие старты за три месяца и все запланированные.' })}
    ${groups.size ? [...groups.entries()].map(([key, items]) => html`<div class="month-block">
      <h2 class="month-title">${fmtMonthYear(`${key}-01`)}</h2>
      <ul class="calendar-list">${items.map((c) => html`<li class="${c.start_date <= today && c.end_date >= today ? 'is-now' : ''}">
        <span class="cal-date mono">${fmtRange(c.start_date, c.end_date)}</span>
        <a href="/competitions/${c.id}">${c.title}</a>
        <span class="chips">${ui.levelChip(c)}${ui.statusPill(c.status)}</span></li>`)}</ul></div>`) : ui.empty('Соревнований пока нет.')}
  </section>`;
  ctx.html(layout(ctx, { title: 'Календарь', section: 'calendar', body }));
}

export function newsList(ctx) {
  const items = listNews();
  const body = html`<section class="wrap section page-readable">
    ${ui.pageHead({ title: 'Новости Федерации' })}
    <div class="news-list">${items.map((n) => html`<article class="news-row">
      <time datetime="${n.published_at}" class="mono">${fmtDate(n.published_at)}</time>
      <div><h2 class="h3"><a href="/news/${n.id}">${n.title}</a></h2><p>${n.excerpt}</p></div></article>`)}</div>
  </section>`;
  ctx.html(layout(ctx, { title: 'Новости', section: 'news', body }));
}

export function newsItem(ctx) {
  const n = getNews(Number(ctx.params.id));
  if (!n) return notFound(ctx);
  const body = html`<article class="wrap section page-readable">
    ${ui.pageHead({ crumbs: [['/news', 'Новости']], eyebrow: fmtDate(n.published_at), title: n.title, lede: n.excerpt })}
    <div class="prose">${paragraphs(n.body)}</div>
  </article>`;
  ctx.html(layout(ctx, { title: n.title, section: 'news', body }));
}

export function documents(ctx) {
  const docs = listDocuments();
  const body = html`<section class="wrap section page-readable">
    ${ui.pageHead({ title: 'Документы Федерации', lede: 'Положения, регламенты, правила вида спорта и полезные материалы.' })}
    ${Object.entries(DOC_CATEGORIES).map(([key, label]) => {
      const items = docs.filter((d) => d.category === key);
      return html`<div class="doc-group"><h2 class="h3">${label}</h2>
        ${items.length ? html`<ul class="doc-list">${items.map((d) => html`<li>
          ${d.url ? html`<a href="${d.url}" ${d.url.startsWith('http') ? html`target="_blank" rel="noopener"` : ''}>${d.title}</a>` : html`<span>${d.title}</span>`}
          ${d.description ? html`<span class="sub">${d.description}</span>` : ''}</li>`)}</ul>` : html`<p class="muted">Документов пока нет.</p>`}</div>`;
    })}
  </section>`;
  ctx.html(layout(ctx, { title: 'Документы', section: 'documents', body }));
}

export function about(ctx) {
  const site = getSettings();
  const contacts = contactLinks(site);
  const federationDocs = listDocuments().filter((d) => d.category === 'FEDERATION');
  const row = (title, content) => html`<section class="about-row"><h2 class="h3">${title}</h2><div class="prose">${content}</div></section>`;
  const body = html`<section class="wrap section page-readable">
    ${ui.pageHead({ title: 'О федерации', lede: site.org_name })}
    <div class="about-rows">
      ${row('Федерация', site.about
        ? paragraphs(site.about)
        : html`<p>Федерация проводит соревнования по спортивному программированию в Республике Дагестан, ведёт календарь стартов и рейтинг спортсменов республики.</p>`)}
      ${row('Дисциплины', html`<dl class="discipline-list">${listDisciplines().map((d) => html`<div>
        <dt><a href="/competitions?d=${encodeURIComponent(d.code)}">${d.name}</a></dt>
        ${DISCIPLINE_INFO[d.code] ? html`<dd>${DISCIPLINE_INFO[d.code]}</dd>` : ''}</div>`)}</dl>`)}
      ${contacts.length ? row('Контакты', html`<div class="contact-list">${contacts}</div>`) : ''}
      ${row('Документы', html`${federationDocs.length
        ? html`<ul class="plain-list">${federationDocs.map((d) => html`<li>${d.url ? html`<a href="${d.url}">${d.title}</a>` : d.title}${d.description ? html`<span class="sub">${d.description}</span>` : ''}</li>`)}</ul>`
        : ''}<p><a href="/documents">Все документы: положения, регламенты, правила вида спорта</a></p>`)}
      ${row('О сайте', html`<p>На сайте спортсмены подают заявки на соревнования и видят свои результаты, а организаторы ведут участников, протоколы и публикуют итоги. Рейтинг пересчитывается сразу после публикации итогов, разбор баллов есть в профиле каждого спортсмена. <a href="/rating/method">Методика рейтинга</a></p>
        <p>Пароли хранятся только в виде хеша. При регистрации спортсмен даёт согласие на обработку персональных данных, за несовершеннолетнего его даёт родитель или законный представитель. Профиль можно скрыть, баллы при этом сохранятся.</p>
        <p>Для школ и разработчиков есть <a href="/api/v1">открытый API</a> с соревнованиями, итогами и рейтингом.</p>`)}
    </div>
  </section>`;
  ctx.html(layout(ctx, { title: 'О федерации', section: 'about', body }));
}
