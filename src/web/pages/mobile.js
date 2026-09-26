// API мобильного приложения ФСП РД (Kotlin Multiplatform). Те же разделы, что на сайте, плюс чаты
// участников и расписание хакатонов. Вход по токену: POST /api/mobile/login возвращает token,
// дальше он передаётся в заголовке Authorization: Bearer <token>.
import { get, all } from '../../db/index.js';
import {
  verifyPassword, createSession, destroySession, isOrganizer, loginKey, loginBlocked, loginFailed, loginSucceeded,
} from '../../core/auth.js';
import { subscribe } from '../../core/events.js';
import { readFileSync } from 'node:fs';
import { ROOT } from '../../config.js';
import path from 'node:path';
import { todayISO, fmtDate, fmtRange, fmtMonthYear, fmtDateTime, addMonths, ageYears } from '../../core/dates.js';
import { fullName, initials, plural } from '../../core/format.js';
import {
  listCompetitions, getCompetition, eventsOf, registrationInfo, PHASES, phaseOf, phaseCounts, FORMAT_LABELS, STATUS_LABELS,
  TRANSITIONS, applyTransition,
} from '../../modules/competitions.js';
import {
  applyToEvent, withdrawRegistration, athleteRegistrationsFor, athleteRegistrations, competitionRegistrations,
  isProfileComplete, setRegistrationStatus, REG_STATUS_LABELS,
} from '../../modules/registrations.js';
import { publishedResults, athleteResults } from '../../modules/results.js';
import {
  leaderboard, athleteRating, ratingHistory, getRatingConfig, qualificationFor, lastRatingChange,
} from '../../modules/rating/service.js';
import { kPlace, kField } from '../../modules/rating/engine.js';
import {
  listDisciplines, listLevels, listRanks, listMunicipalities, listOrganizations, disciplineByCode, levelByCode, DISCIPLINE_INFO,
} from '../../modules/dictionaries.js';
import {
  getAthlete, athleteByUser, athleteDisciplines, rankHistory, validateProfile, updateAthleteProfile,
  readRegistration, validateRegistration, createAthleteAccount, validateRank, submitRankRequest, RANK_STATUS_LABELS,
} from '../../modules/athletes.js';
import { listNews, getNews, listDocuments, DOC_CATEGORIES } from '../../modules/content.js';
import { listNotifications, unreadCount, markAllRead } from '../../modules/notifications.js';
import { getSettings } from '../../modules/settings.js';
import {
  getContest, contestWindow, syncContestStatus, listTasks, participation, joinContest, submitSolution,
  athleteSubmissions, athleteContests, submissionCounts, standings,
} from '../../modules/contests.js';
import {
  openChat, canUseChat, listMessages, postMessage, markRead, userChats, unreadChats, athleteMembersCount, chatMembers, chatOf,
  isMember, messageById,
} from '../../modules/chats.js';
import {
  SCHEDULE_KINDS, listSchedule, scheduleNow, readScheduleInput, validateScheduleItem, addScheduleItem, updateScheduleItem,
  deleteScheduleItem, getScheduleItem, upcomingForUser, announcement,
} from '../../modules/schedule.js';
import { SAMPLE_ACCOUNTS, sampleLoaded } from './auth.js';
import { CLOSED_PANEL } from './public.js';

const ACTIVE = ['SUBMITTED', 'APPROVED'];
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const pad = (n) => String(n).padStart(2, '0');
const idParam = (ctx) => Number(ctx.params.id);
const text = (v, max = 5000) => String(v ?? '').trim().slice(0, max);

function fail(ctx, status, error, extra = {}) {
  ctx.json({ error, ...extra }, status);
}

function needUser(ctx) {
  if (ctx.user) return true;
  fail(ctx, 401, 'Войдите в аккаунт', { code: 'auth' });
  return false;
}

function needAthlete(ctx) {
  if (!needUser(ctx)) return false;
  if (ctx.athlete) return true;
  fail(ctx, 403, 'Раздел для спортсменов. Вы вошли как организатор.');
  return false;
}

function needOrganizer(ctx) {
  if (!needUser(ctx)) return false;
  if (ctx.isOrganizer) return true;
  fail(ctx, 403, 'Раздел доступен только организаторам Федерации.');
  return false;
}

// Имя спортсмена видно, если профиль открыт, это сам спортсмен или смотрит организатор.
function visibleName(ctx, a, athleteId) {
  const visible = a.is_public || ctx.isOrganizer || (ctx.athlete && ctx.athlete.id === athleteId);
  return {
    athleteId: visible ? athleteId : null,
    name: visible ? fullName(a) : 'Профиль скрыт',
    hidden: !visible,
    isMe: Boolean(ctx.athlete && ctx.athlete.id === athleteId),
  };
}

// Время из SQLite (UTC) в местное: «14:05», день и подпись дня для разделителей в чате.
function whenOf(sqliteUtc) {
  const s = String(sqliteUtc || '');
  const d = new Date(s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return { time: '', day: '', dayLabel: '', ms: 0 };
  const day = todayISO(d);
  return { time: `${pad(d.getHours())}:${pad(d.getMinutes())}`, day, dayLabel: fmtDate(day, { year: day.slice(0, 4) !== todayISO().slice(0, 4) }), ms: d.getTime() };
}

// ---------- DTO ----------

const placeOf = (c) => (c.format === 'ONLINE' ? FORMAT_LABELS.ONLINE : [c.city, c.venue].filter(Boolean).join(', '));
const hasSchedule = (competitionId) => Boolean(get('SELECT 1 AS x FROM schedule_items WHERE competition_id = ? LIMIT 1', competitionId));

function competitionCard(c) {
  const events = c.events || eventsOf(c.id);
  const reg = registrationInfo(c);
  return {
    id: c.id,
    title: c.title,
    status: c.status,
    statusLabel: STATUS_LABELS[c.status],
    phase: phaseOf(c.status),
    level: { code: c.level_code, name: c.level_name, short: c.level_short, basePoints: c.base_points },
    format: c.format,
    formatLabel: FORMAT_LABELS[c.format],
    place: placeOf(c),
    startDate: c.start_date,
    endDate: c.end_date,
    dates: fmtRange(c.start_date, c.end_date),
    registration: { open: reg.open, soon: Boolean(reg.soon), text: reg.text },
    disciplines: events.map((e) => ({ code: e.discipline_code, name: e.discipline_name, short: e.discipline_short, registered: e.registered })),
    isHackathon: events.some((e) => e.discipline_code === 'PRODUCT') || hasSchedule(c.id),
    onPlatform: Boolean(c.on_platform),
    isExternal: Boolean(c.is_external),
  };
}

function qualificationDto(q) {
  if (!q) return null;
  return { name: q.name, short: q.shortName || q.short_name, kind: q.kind || 'RANK', bonus: q.bonus ?? q.bonus_points ?? 0, validUntil: q.validUntil || null };
}

function leaderDto(ctx, r, cfg) {
  return {
    position: r.position,
    ...visibleName(ctx, r.athlete, r.athlete.id),
    organization: r.athlete.organization,
    municipality: r.athlete.municipality,
    qualification: qualificationDto(r.rating.qualification),
    rating: round1(r.rating.total),
    counted: r.rating.counted.length,
    topN: cfg.topN,
  };
}

const newsDto = (n, full = false) => ({
  id: n.id,
  title: n.title,
  excerpt: n.excerpt,
  date: n.published_at,
  dateLabel: fmtDate(n.published_at),
  ...(full ? { body: n.body } : {}),
});

// Куда ведёт уведомление: ссылки сайта превращаются в экраны приложения.
function targetOf(link) {
  const s = String(link || '');
  let m = /^\/competitions\/(\d+)\/chat/.exec(s);
  if (m) return { type: 'chat', competitionId: Number(m[1]) };
  m = /^\/competitions\/(\d+)#schedule-(\d+)/.exec(s);
  if (m) return { type: 'schedule', competitionId: Number(m[1]), itemId: Number(m[2]) };
  m = /^\/competitions\/(\d+)/.exec(s);
  if (m) return { type: 'competition', competitionId: Number(m[1]) };
  m = /^\/athletes\/(\d+)/.exec(s);
  if (m) return { type: 'athlete', athleteId: Number(m[1]) };
  if (s.startsWith('/cabinet/profile')) return { type: 'profile' };
  if (s.startsWith('/competitions')) return { type: 'competitions' };
  return { type: 'none' };
}

const notificationDto = (n) => ({
  id: n.id,
  title: n.title,
  body: n.body,
  link: n.link,
  target: targetOf(n.link),
  createdAt: fmtDateTime(n.created_at),
  read: Boolean(n.read_at),
});

function scheduleDto(s) {
  return {
    id: s.id,
    competitionId: s.competition_id,
    kind: s.kind,
    kindLabel: s.kind_label,
    title: s.title,
    description: s.description,
    date: s.date,
    time: s.time,
    dateLabel: s.date_label,
    startsAtMs: s.starts_at_ms,
    isPast: s.is_past,
    notified: Boolean(s.notified_at),
  };
}

function scheduleNowDto(competitionId) {
  const { current, next } = scheduleNow(competitionId);
  return { current: current ? scheduleDto(current) : null, next: next ? scheduleDto(next) : null };
}

function messageDto(m, user) {
  const w = whenOf(m.created_at);
  return {
    id: m.id,
    body: m.body,
    author: m.author,
    mine: Boolean(user && m.user_id === user.id),
    time: w.time,
    day: w.day,
    dayLabel: w.dayLabel,
  };
}

function meDto(ctx) {
  const u = ctx.user;
  const a = ctx.athlete;
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    isOrganizer: ctx.isOrganizer,
    athlete: a
      ? {
          id: a.id,
          name: fullName(a),
          lastName: a.last_name,
          firstName: a.first_name,
          middleName: a.middle_name,
          initials: initials(a),
          isPublic: Boolean(a.is_public),
          profileComplete: isProfileComplete(a),
          municipality: a.municipality,
          organization: a.organization,
        }
      : null,
    unreadNotifications: unreadCount(u.id),
    unreadChats: unreadChats(u),
  };
}

// ---------- настройки приложения и вход ----------

export function config(ctx) {
  const site = getSettings();
  const sample = sampleLoaded();
  ctx.json({
    name: 'ФСП РД',
    orgName: site.org_name,
    apiVersion: 1,
    serverTime: Date.now(),
    sample,
    demoAccounts: sample ? Object.entries(SAMPLE_ACCOUNTS).map(([key, a]) => ({ key, label: a.label, hint: a.hint })) : [],
    scheduleKinds: Object.entries(SCHEDULE_KINDS).map(([code, label]) => ({ code, label })),
    disciplines: listDisciplines().map((d) => ({ code: d.code, name: d.name, short: d.short_name })),
    levels: listLevels().map((l) => ({ code: l.code, name: l.name, short: l.short_name })),
  });
}

function respondWithSession(ctx, userId, status = 200) {
  const { token } = createSession(userId);
  ctx.user = get('SELECT id, email, role FROM users WHERE id = ?', userId);
  ctx.athlete = athleteByUser(userId) || null;
  ctx.isOrganizer = isOrganizer(ctx.user);
  ctx.json({ token, me: meDto(ctx) }, status);
}

export function login(ctx) {
  const email = text(ctx.body.email, 200).toLowerCase();
  const password = String(ctx.body.password || '');
  const key = loginKey(ctx.req, email);
  if (loginBlocked(key)) return fail(ctx, 429, 'Слишком много попыток входа. Попробуйте через 15 минут.');
  const user = get('SELECT * FROM users WHERE email = ?', email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    loginFailed(key);
    return fail(ctx, 400, 'Неверная почта или пароль. Проверьте раскладку и попробуйте ещё раз.');
  }
  loginSucceeded(key);
  respondWithSession(ctx, user.id);
}

export function demoLogin(ctx) {
  const account = SAMPLE_ACCOUNTS[text(ctx.body.as, 40)];
  const user = account && sampleLoaded() ? get('SELECT * FROM users WHERE email = ?', account.email) : null;
  if (!user) return fail(ctx, 400, 'Быстрый вход доступен только с примером наполнения: npm run sample');
  respondWithSession(ctx, user.id);
}

export function register(ctx) {
  const b = ctx.body;
  const values = readRegistration({
    last_name: b.lastName, first_name: b.firstName, middle_name: b.middleName, email: b.email, consent: b.consent === true,
  });
  const password = String(b.password || '');
  const errors = validateRegistration(values, password);
  if (Object.keys(errors).length) {
    const map = { last_name: 'lastName', first_name: 'firstName', middle_name: 'middleName' };
    const fields = Object.fromEntries(Object.entries(errors).map(([k, v]) => [map[k] || k, v]));
    return fail(ctx, 400, Object.values(errors)[0], { fields });
  }
  respondWithSession(ctx, createAthleteAccount(values, password), 201);
}

export function logout(ctx) {
  destroySession(ctx.token);
  ctx.json({ ok: true });
}

export function me(ctx) {
  if (!needUser(ctx)) return;
  ctx.json(meDto(ctx));
}

const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

export function health(ctx) {
  ctx.json({ ok: true, version: VERSION, time: new Date().toISOString(), database: Boolean(get('SELECT 1 AS x')) });
}

// Живой поток событий (Server-Sent Events): новые уведомления и сообщения чатов приходят сразу.
// Приложение держит его открытым, пока запущено; при обрыве переподключается, опрос остаётся запасным путём.
export function events(ctx) {
  if (!needUser(ctx)) return;
  const { req, res, user } = ctx;
  const organizer = ctx.isOrganizer;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send('ready', { unread: unreadCount(user.id), unreadChats: unreadChats(user) });
  const unsubscribe = subscribe((e) => {
    try {
      if (e.type === 'notification' && e.userId === user.id) {
        const n = get('SELECT * FROM notifications WHERE id = ?', e.id);
        if (n) send('notification', { notification: notificationDto(n), unread: unreadCount(user.id) });
      } else if (e.type === 'chat' && (organizer || isMember(e.chatId, user.id))) {
        const m = messageById(e.messageId);
        if (m) send('message', { competitionId: e.competitionId, message: messageDto(m, user) });
      } else if (e.type === 'membership' && e.userId === user.id) {
        send('chats', { competitionId: e.competitionId });
      }
    } catch (err) {
      console.error(err);
    }
  });
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
}

// ---------- главная и соревнования ----------

export function home(ctx) {
  const today = todayISO();
  const upcoming = listCompetitions({ phase: 'upcoming' }).filter((c) => c.start_date >= today);
  const current = listCompetitions({ phase: 'current' });
  const featured = upcoming.find((c) => registrationInfo(c).open) || upcoming[0] || current[0] || null;
  const starts = [...current, ...upcoming].filter((c) => c.id !== featured?.id).slice(0, 4);
  const cfg = getRatingConfig();
  const site = getSettings();
  ctx.json({
    myEvents: myEvents(ctx),
    orgName: site.org_name,
    about: site.about ? site.about.split(/\n\s*\n/)[0] : null,
    featured: featured ? { ...competitionCard(featured), label: featured.status === 'ONGOING' ? 'Соревнование идёт' : 'Ближайший старт' } : null,
    starts: starts.map(competitionCard),
    news: listNews(3).map((n) => newsDto(n)),
    leaders: leaderboard({ limit: 5 }).rows.map((r) => leaderDto(ctx, r, cfg)),
    disciplines: listDisciplines().map((d) => ({ code: d.code, name: d.name, short: d.short_name, info: DISCIPLINE_INFO[d.code] || null })),
  });
}

// «Мои хакатоны» на главной: куда спортсмен допущен, а организатору — идущие соревнования.
function myEvents(ctx) {
  if (!ctx.user) return [];
  let list;
  if (ctx.isOrganizer) {
    list = listCompetitions({ phase: 'current' });
  } else if (ctx.athlete) {
    const ids = new Set(
      all(
        `SELECT DISTINCT e.competition_id AS id FROM registrations r JOIN competition_events e ON e.id = r.event_id
          WHERE r.athlete_id = ? AND r.status = 'APPROVED'`,
        ctx.athlete.id,
      ).map((r) => r.id),
    );
    list = [...listCompetitions({ phase: 'current' }), ...listCompetitions({ phase: 'upcoming' })].filter((c) => ids.has(c.id));
  } else {
    return [];
  }
  return list.slice(0, 5).map((c) => {
    const chat = chatOf(c.id);
    const items = listSchedule(c.id);
    const past = items.filter((s) => s.is_past).length;
    return {
      ...competitionCard(c),
      now: scheduleNowDto(c.id),
      scheduleTotal: items.length,
      schedulePassed: past,
      chatUnread: chat && canUseChat(ctx.user, c.id) ? unreadInChat(ctx.user, chat.id) : 0,
      chatMembers: chat ? athleteMembersCount(chat.id) : 0,
    };
  });
}

export function competitions(ctx) {
  const tab = PHASES[ctx.query.get('tab')] ? ctx.query.get('tab') : 'upcoming';
  const discipline = disciplineByCode(ctx.query.get('d'));
  const level = levelByCode(ctx.query.get('level'));
  const list = listCompetitions({ phase: tab, disciplineId: discipline?.id, levelId: level?.id });
  const counts = phaseCounts();
  ctx.json({
    tab,
    tabs: Object.entries(PHASES).map(([key, p]) => ({ key, label: p.label, count: counts[key] || 0 })),
    items: list.map(competitionCard),
  });
}

function contestDto(ctx, c, k) {
  const { start, end } = contestWindow(c, k);
  const tasks = listTasks(c.id);
  const isParticipant = Boolean(ctx.athlete && participation(c.id, ctx.athlete.id));
  const visible = (c.status === 'ONGOING' && (isParticipant || ctx.isOrganizer)) || ['FINISHED', 'RESULTS_PUBLISHED'].includes(c.status);
  const mine = ctx.athlete ? athleteSubmissions(c.id, ctx.athlete.id) : [];
  let hiddenText = null;
  if (!tasks.length) hiddenText = 'Задания ещё не добавлены.';
  else if (!visible) hiddenText = c.status === 'ONGOING' ? 'Задания видны участникам контеста.' : `Задания откроются в момент старта: ${fmtDate(c.start_date)} в ${k.start_time}.`;

  let join = null;
  if (c.status === 'ONGOING' && ctx.athlete && !isParticipant) {
    join = isProfileComplete(ctx.athlete) ? 'open' : 'profile';
  } else if (c.status === 'ONGOING' && !ctx.user) join = 'login';

  let table = null;
  if (['FINISHED', 'RESULTS_PUBLISHED'].includes(c.status)) {
    const s = standings(c.id);
    table = {
      final: c.status === 'RESULTS_PUBLISHED',
      tasks: s.tasks.map((t) => ({ id: t.id, letter: t.letter, maxScore: t.max_score })),
      rows: s.rows.map((r) => ({
        place: r.place,
        ...visibleName(ctx, r.athlete, r.athleteId),
        organization: r.athlete.organization,
        total: r.total,
        pending: r.pending,
        cells: s.tasks.map((t) => {
          const cell = r.cells.get(t.id);
          return cell ? { best: cell.best, attempts: cell.attempts, pending: cell.pending } : null;
        }),
      })),
    };
  }
  const counts = submissionCounts(c.id);
  return {
    startTime: k.start_time,
    endTime: k.end_time,
    startsAtMs: start.getTime(),
    endsAtMs: end.getTime(),
    rules: k.rules || null,
    isParticipant,
    join,
    canSubmit: c.status === 'ONGOING' && isParticipant,
    tasksVisible: visible && tasks.length > 0,
    hiddenText,
    maxTotal: tasks.reduce((sum, t) => sum + t.max_score, 0),
    submissions: { total: counts.total, pending: counts.pending, mine: mine.length, mineChecked: mine.filter((s) => s.score !== null).length },
    tasks: visible
      ? tasks.map((t) => {
          const my = mine.filter((s) => s.task_id === t.id);
          const checked = my.filter((s) => s.score !== null);
          return {
            id: t.id,
            letter: t.letter,
            title: t.title,
            statement: t.statement,
            maxScore: t.max_score,
            materialsUrl: t.materials_url,
            best: checked.length ? Math.max(...checked.map((s) => s.score)) : null,
            attempts: my.map((s) => ({
              id: s.id,
              createdAt: fmtDateTime(s.created_at),
              text: s.answer_text,
              url: s.answer_url,
              score: s.score,
              maxScore: s.max_score,
              comment: s.comment,
            })),
          };
        })
      : [],
    standings: table,
  };
}

export function competition(ctx) {
  let c = getCompetition(idParam(ctx));
  if (!c || (c.status === 'DRAFT' && !ctx.isOrganizer)) return fail(ctx, 404, 'Соревнование не найдено');
  if (c.on_platform) c = syncContestStatus(c);
  const k = c.on_platform ? getContest(c.id) : null;
  const events = eventsOf(c.id);
  const reg = registrationInfo(c);
  const mine = ctx.athlete ? athleteRegistrationsFor(c.id, ctx.athlete.id) : [];
  const taken = new Set(mine.filter((r) => ACTIVE.includes(r.status)).map((r) => r.event_id));
  const freeEvents = events.filter((e) => !taken.has(e.id));

  let applyState = 'closed';
  if (reg.open) {
    if (!ctx.user) applyState = 'login';
    else if (!ctx.athlete) applyState = 'organizer';
    else if (!isProfileComplete(ctx.athlete)) applyState = 'profile';
    else applyState = freeEvents.length ? 'open' : 'applied';
  }

  const approved = mine.some((r) => r.status === 'APPROVED');
  const chatAllowed = canUseChat(ctx.user, c.id);
  let chatHint = 'Чат открыт для участников, чью заявку одобрил организатор.';
  if (mine.some((r) => r.status === 'SUBMITTED') && !approved) chatHint = 'Заявка на рассмотрении. Когда организатор её одобрит, вас добавят в чат участников.';
  const chat = chatOf(c.id);

  const results = c.status === 'RESULTS_PUBLISHED' && !k ? publishedResults(c.id) : [];
  const registrations = competitionRegistrations(c.id);
  const participants = registrations.filter((r) => ACTIVE.includes(r.status));
  const closed = CLOSED_PANEL[c.status];

  ctx.json({
    ...competitionCard({ ...c, events }),
    description: c.description || null,
    city: c.city,
    venue: c.venue,
    regulationsUrl: c.regulations_url,
    registrationPeriod: c.reg_start || c.reg_end
      ? `${c.reg_start ? `с ${fmtDate(c.reg_start)} ` : ''}${c.reg_end ? `до ${fmtDate(c.reg_end)}` : ''}`.trim()
      : 'сроки не указаны',
    panel: reg.open
      ? { title: 'Заявка на участие', text: `${reg.text}.` }
      : { title: closed?.[0] || 'Заявка на участие', text: closed?.[1] || `${reg.text}.` },
    apply: {
      state: applyState,
      events: freeEvents.map((e) => ({ id: e.id, short: e.discipline_short, name: e.discipline_name })),
    },
    myRegistrations: mine.map((r) => ({
      id: r.id,
      eventId: r.event_id,
      discipline: r.discipline_short,
      status: r.status,
      statusLabel: REG_STATUS_LABELS[r.status],
      canWithdraw: ACTIVE.includes(r.status) && reg.open,
    })),
    isApproved: approved,
    chat: {
      available: chatAllowed,
      hint: chatAllowed ? null : chatHint,
      members: chat ? athleteMembersCount(chat.id) : 0,
      unread: chatAllowed && chat ? unreadInChat(ctx.user, chat.id) : 0,
    },
    schedule: listSchedule(c.id).map(scheduleDto),
    scheduleNow: scheduleNowDto(c.id),
    contest: k ? contestDto(ctx, c, k) : null,
    results: results.map((r) => ({
      discipline: r.event.discipline_name,
      participants: r.participants,
      rows: r.rows.map((row) => ({
        place: row.place,
        ...visibleName(ctx, row, row.athlete_id),
        organization: row.organization,
        municipality: row.municipality,
        score: row.score,
        points: round1(row.points),
      })),
    })),
    participants: participants.map((r) => ({
      registrationId: r.id,
      ...visibleName(ctx, r, r.athlete_id),
      organization: r.organization,
      municipality: r.municipality,
      discipline: r.discipline_short,
      status: r.status,
      statusLabel: REG_STATUS_LABELS[r.status],
    })),
    admin: ctx.isOrganizer
      ? {
          pending: registrations.filter((r) => r.status === 'SUBMITTED').length,
          approved: registrations.filter((r) => r.status === 'APPROVED').length,
          total: registrations.length,
          transitions: adminTransitions(c.status),
        }
      : null,
  });
}

// Статусы, которые организатор меняет из приложения. Публикация итогов — на сайте: там проверка протокола.
const APP_ACTIONS = ['publish', 'start', 'finish', 'cancel', 'unpublish'];
const adminTransitions = (status) =>
  (TRANSITIONS[status] || [])
    .filter((t) => APP_ACTIONS.includes(t.action))
    .map((t) => ({ action: t.action, label: t.label, hint: t.hint || null, danger: Boolean(t.danger) }));

export function adminTransition(ctx) {
  if (!needOrganizer(ctx)) return;
  const action = text(ctx.body.action, 30);
  if (!APP_ACTIONS.includes(action)) return fail(ctx, 400, 'Это действие доступно только на сайте');
  const r = applyTransition(idParam(ctx), action, ctx.user.id);
  if (r.error) return fail(ctx, 400, r.error);
  const messages = {
    ONGOING: 'Соревнование началось. Допущенные участники получили уведомление, пункты расписания будут приходить им по времени.',
    FINISHED: 'Соревнование завершено. Внесите и опубликуйте итоги на сайте.',
    PUBLISHED: 'Соревнование опубликовано, регистрация откроется по датам.',
    DRAFT: 'Соревнование возвращено в черновик.',
    CANCELLED: 'Соревнование отменено.',
  };
  ctx.json({ ok: true, status: r.to, message: messages[r.to] || r.label });
}

function unreadInChat(user, chatId) {
  return get(
    `SELECT COUNT(*) AS n FROM chat_messages x
      WHERE x.chat_id = ? AND x.id > COALESCE((SELECT last_read_id FROM chat_members WHERE chat_id = ? AND user_id = ?), 0)
        AND (x.user_id IS NULL OR x.user_id <> ?)`,
    chatId, chatId, user.id, user.id,
  ).n;
}

export function apply(ctx) {
  if (!needAthlete(ctx)) return;
  const r = applyToEvent(ctx.athlete, Number(ctx.body.eventId));
  if (r.error === 'profile') return fail(ctx, 400, 'Сначала укажите в профиле населённый пункт и образовательную организацию.', { code: 'profile' });
  if (r.error) return fail(ctx, 400, r.error);
  ctx.json({ ok: true, message: 'Заявка подана. Когда организатор её одобрит, вас добавят в чат участников.' });
}

export function withdraw(ctx) {
  if (!needAthlete(ctx)) return;
  const r = withdrawRegistration(ctx.athlete, idParam(ctx));
  if (r.error) return fail(ctx, 400, r.error);
  ctx.json({ ok: true, message: 'Заявка отозвана.' });
}

export function joinContestHandler(ctx) {
  if (!needAthlete(ctx)) return;
  const r = joinContest(ctx.athlete, idParam(ctx));
  if (r.error === 'profile') return fail(ctx, 400, 'Чтобы участвовать, укажите в профиле населённый пункт и образовательную организацию.', { code: 'profile' });
  if (r.error) return fail(ctx, 400, r.error);
  ctx.json({ ok: true, message: 'Вы участвуете. Задания открыты.' });
}

export function submit(ctx) {
  if (!needAthlete(ctx)) return;
  const r = submitSolution(ctx.athlete, idParam(ctx), { text: ctx.body.text, url: ctx.body.url });
  if (r.error) return fail(ctx, 400, r.error);
  ctx.json({ ok: true, message: `Решение по заданию ${r.letter} отправлено на проверку.` });
}

export function schedule(ctx) {
  const c = getCompetition(idParam(ctx));
  if (!c || (c.status === 'DRAFT' && !ctx.isOrganizer)) return fail(ctx, 404, 'Соревнование не найдено');
  ctx.json({ items: listSchedule(c.id).map(scheduleDto), now: scheduleNowDto(c.id) });
}

// Будущие пункты расписания, куда пользователь допущен: приложение ставит по ним напоминания.
export function upcomingSchedule(ctx) {
  if (!needUser(ctx)) return;
  ctx.json({
    items: upcomingForUser(ctx.user.id).map((s) => ({
      ...scheduleDto(s),
      competitionTitle: s.competition_title,
      notificationTitle: announcement(s),
      notificationBody: [s.competition_title, s.description].filter(Boolean).join(' · '),
    })),
  });
}

// ---------- рейтинг и профили ----------

export function rating(ctx) {
  const cfg = getRatingConfig();
  const discipline = disciplineByCode(ctx.query.get('d'));
  const municipalityId = Number(ctx.query.get('m')) || null;
  const q = text(ctx.query.get('q'), 60);
  const board = leaderboard({ disciplineId: discipline?.id || null, municipalityId, q });
  ctx.json({
    asOf: board.asOf,
    asOfLabel: fmtDate(board.asOf),
    discipline: discipline?.code || null,
    total: board.total,
    shown: board.rows.length,
    topN: cfg.topN,
    windowMonths: cfg.windowMonths,
    disciplines: listDisciplines().map((d) => ({ code: d.code, short: d.short_name })),
    municipalities: listMunicipalities().map((m) => ({ id: m.id, name: m.name })),
    items: board.rows.map((r) => leaderDto(ctx, r, cfg)),
  });
}

export function method(ctx) {
  const cfg = getRatingConfig();
  ctx.json({
    version: cfg.version,
    topN: cfg.topN,
    windowMonths: cfg.windowMonths,
    fullMonths: cfg.fullMonths,
    placeFloor: cfg.placeFloor,
    fieldRef: cfg.fieldRef,
    fieldMin: cfg.fieldMin,
    levels: listLevels().map((l) => ({ name: l.name, basePoints: l.base_points })),
    ranks: listRanks().map((r) => ({ name: r.name, bonus: r.bonus_points })),
    placeExamples: [1, 2, 3, 5, 10, 25, 50].map((m) => ({ value: m, k: round3(kPlace(m, 50, cfg)) })),
    fieldExamples: [1, 5, 10, 20, 30, 50].map((n) => ({ value: n, k: round3(kField(n, cfg)) })),
  });
}

function breakdownLine(l, cfg) {
  return {
    competitionId: l.competitionId,
    title: l.competitionTitle,
    levelShort: l.levelShort,
    discipline: l.disciplineName,
    date: fmtDate(l.date),
    place: l.place,
    participants: l.participants,
    ageMonths: l.ageMonths,
    basePoints: l.basePoints,
    kPlace: round3(l.kPlace),
    kField: round3(l.kField),
    kTime: round3(l.kTime),
    points: round1(l.points),
    counted: l.counted,
    reason: l.reason === 'outside' ? `вне топ-${cfg.topN}` : l.reason === 'expired' ? `старше ${cfg.windowMonths} мес.` : null,
  };
}

export function athlete(ctx) {
  const a = getAthlete(idParam(ctx));
  if (!a) return fail(ctx, 404, 'Спортсмен не найден');
  const own = ctx.athlete?.id === a.id;
  if (!a.is_public && !own && !ctx.isOrganizer) {
    return fail(ctx, 403, 'Спортсмен скрыл профиль. Его результаты учитываются в рейтинге, но имя и история видны только ему и организаторам.', { code: 'hidden' });
  }
  const cfg = getRatingConfig();
  const results = athleteResults(a.id);
  const resultDisciplines = new Set(results.map((r) => r.discipline_short));
  const discipline = disciplineByCode(ctx.query.get('d'));
  const abs = athleteRating(a.id);
  const view = discipline ? athleteRating(a.id, { disciplineId: discipline.id }) : abs;
  const history = ratingHistory(a.id);
  const age = ageYears(a.birth_date);
  ctx.json({
    id: a.id,
    name: fullName(a),
    initials: initials(a),
    meta: [a.organization, a.municipality, age ? `${age} ${plural(age, ['год', 'года', 'лет'])}` : null].filter(Boolean).join(' · '),
    isPublic: Boolean(a.is_public),
    isMe: own,
    qualification: qualificationDto(qualificationFor(a.id)),
    disciplines: athleteDisciplines(a.id).map((d) => d.short_name),
    rating: round1(abs.rating.total),
    position: abs.position,
    of: abs.of,
    tabs: [{ code: null, label: 'Общий зачёт' }, ...listDisciplines().filter((d) => resultDisciplines.has(d.short_name)).map((d) => ({ code: d.code, label: d.short_name }))],
    view: {
      discipline: discipline?.code || null,
      total: round1(view.rating.total),
      position: view.position,
      of: view.of,
      bonus: round1(view.rating.bonus),
      lines: [...view.rating.counted, ...view.rating.excluded].map((l) => breakdownLine(l, cfg)),
    },
    summary: {
      counted: abs.rating.counted.length,
      topN: cfg.topN,
      windowMonths: cfg.windowMonths,
      starts: results.length,
      podiums: results.filter((r) => r.place && r.place <= 3).length,
      yearChange: round1(history[history.length - 1].total - history[0].total),
    },
    history: history.map((h) => ({ date: h.date, total: round1(h.total) })),
    ranks: rankHistory(a.id).filter((r) => r.status === 'CONFIRMED').map((r) => ({
      name: r.rank_name,
      assigned: fmtDate(r.assigned_at),
      validUntil: r.valid_until ? fmtDate(r.valid_until) : null,
      expired: Boolean(r.valid_until && r.valid_until < todayISO()),
    })),
    results: results.map((r) => ({
      competitionId: r.competition_id,
      title: r.title,
      date: fmtDate(r.end_date),
      levelShort: r.level_short,
      discipline: r.discipline_short,
      place: r.place,
      participants: r.participants,
    })),
  });
}

// ---------- информационные разделы ----------

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
  ctx.json({
    months: [...groups.entries()].map(([key, items]) => ({
      key,
      label: fmtMonthYear(`${key}-01`),
      items: items.map((c) => ({ ...competitionCard(c), isNow: c.start_date <= today && c.end_date >= today })),
    })),
  });
}

export function news(ctx) {
  ctx.json({ items: listNews().map((n) => newsDto(n)) });
}

export function newsItem(ctx) {
  const n = getNews(idParam(ctx));
  if (!n) return fail(ctx, 404, 'Новость не найдена');
  ctx.json(newsDto(n, true));
}

export function documents(ctx) {
  const docs = listDocuments();
  ctx.json({
    groups: Object.entries(DOC_CATEGORIES).map(([key, label]) => ({
      key,
      label,
      items: docs.filter((d) => d.category === key).map((d) => ({ id: d.id, title: d.title, url: d.url, description: d.description })),
    })),
  });
}

export function about(ctx) {
  const site = getSettings();
  const contacts = [];
  if (site.address) contacts.push({ kind: 'address', label: site.address, url: null });
  if (site.phone) contacts.push({ kind: 'phone', label: site.phone, url: `tel:${site.phone.replace(/[^\d+]/g, '')}` });
  if (site.email) contacts.push({ kind: 'email', label: site.email, url: `mailto:${site.email}` });
  if (site.telegram) contacts.push({ kind: 'telegram', label: 'Telegram', url: site.telegram });
  if (site.vk) contacts.push({ kind: 'vk', label: 'ВКонтакте', url: site.vk });
  ctx.json({
    orgName: site.org_name,
    about: site.about || 'Федерация проводит соревнования по спортивному программированию в Республике Дагестан, ведёт календарь стартов и рейтинг спортсменов республики.',
    contacts,
    disciplines: listDisciplines().map((d) => ({ code: d.code, name: d.name, info: DISCIPLINE_INFO[d.code] || null })),
    federationDocuments: listDocuments().filter((d) => d.category === 'FEDERATION').map((d) => ({ id: d.id, title: d.title, url: d.url, description: d.description })),
  });
}

// ---------- кабинет спортсмена ----------

export function cabinet(ctx) {
  if (!needAthlete(ctx)) return;
  const a = ctx.athlete;
  const { rating: r, position, of } = athleteRating(a.id);
  const change = lastRatingChange(a.id);
  const q = qualificationFor(a.id);
  const pending = rankHistory(a.id).filter((x) => x.status === 'PENDING');
  const byPhase = { upcoming: [], current: [], finished: [] };
  for (const reg of athleteRegistrations(a.id)) {
    const phase = phaseOf(reg.competition_status);
    if (!byPhase[phase]) continue;
    byPhase[phase].push({
      id: reg.id,
      competitionId: reg.competition_id,
      title: reg.title,
      dates: fmtRange(reg.start_date, reg.end_date),
      startDate: reg.start_date,
      discipline: reg.discipline_short,
      status: reg.status,
      statusLabel: REG_STATUS_LABELS[reg.status],
      competitionStatus: reg.competition_status,
      place: reg.competition_status === 'RESULTS_PUBLISHED' ? reg.place : null,
      of: reg.participants_total || reg.placed || null,
      resultText: reg.competition_status === 'CANCELLED' ? 'отменено' : reg.competition_status === 'RESULTS_PUBLISHED' && reg.place ? null : 'ждём итоги',
    });
  }
  ctx.json({
    me: meDto(ctx),
    rating: { total: round1(r.total), position, of },
    change: change
      ? {
          delta: round1(change.rating_after - change.rating_before),
          competitionId: change.competition_id,
          competitionTitle: change.competition_title,
          positionBefore: change.position_before,
          positionAfter: change.position_after,
        }
      : null,
    qualification: qualificationDto(q),
    qualificationText: q ? `+${q.bonus} к рейтингу${q.validUntil ? `, до ${fmtDate(q.validUntil)}` : ''}` : 'Нет подтверждённого разряда',
    pendingRanks: pending.map((p) => p.rank_short),
    registrations: Object.entries(PHASES).map(([key, p]) => ({ key, label: p.label, items: byPhase[key] })),
    contests: athleteContests(a.id).map((c) => ({
      id: c.id,
      title: c.title,
      status: c.status,
      dates: fmtRange(c.start_date, c.end_date),
      tasks: c.tasks,
      submitted: c.submitted,
      checked: c.checked,
      url: `/competitions/${c.id}#tasks`,
    })),
    notifications: listNotifications(ctx.user.id, 20).map(notificationDto),
    unread: unreadCount(ctx.user.id),
  });
}

export function notifications(ctx) {
  if (!needUser(ctx)) return;
  const after = Number(ctx.query.get('after')) || 0;
  const items = after
    ? all('SELECT * FROM notifications WHERE user_id = ? AND id > ? ORDER BY id LIMIT 50', ctx.user.id, after)
    : listNotifications(ctx.user.id, Math.min(Number(ctx.query.get('limit')) || 50, 100));
  const last = get('SELECT MAX(id) AS id FROM notifications WHERE user_id = ?', ctx.user.id).id || 0;
  ctx.json({ items: items.map(notificationDto), unread: unreadCount(ctx.user.id), unreadChats: unreadChats(ctx.user), lastId: last });
}

export function readNotifications(ctx) {
  if (!needUser(ctx)) return;
  markAllRead(ctx.user.id);
  ctx.json({ ok: true });
}

export function profile(ctx) {
  if (!needAthlete(ctx)) return;
  const a = ctx.athlete;
  ctx.json({
    values: {
      lastName: a.last_name,
      firstName: a.first_name,
      middleName: a.middle_name,
      birthDate: a.birth_date,
      municipalityId: a.municipality_id,
      organizationId: a.organization_id,
      disciplineIds: athleteDisciplines(a.id).map((d) => d.id),
      isPublic: Boolean(a.is_public),
    },
    municipalities: listMunicipalities().map((m) => ({ id: m.id, name: m.name })),
    organizations: listOrganizations().map((o) => ({ id: o.id, name: o.name, municipality: o.municipality })),
    disciplines: listDisciplines().map((d) => ({ id: d.id, name: d.name, short: d.short_name })),
    ranks: listRanks().map((r) => ({ id: r.id, name: r.name, short: r.short_name, kind: r.kind, bonus: r.bonus_points })),
    rankHistory: rankHistory(a.id).map((r) => ({
      id: r.id,
      name: r.rank_name,
      status: r.status,
      statusLabel: RANK_STATUS_LABELS[r.status],
      orderNumber: r.order_number,
      assigned: fmtDate(r.assigned_at),
      validUntil: r.valid_until ? fmtDate(r.valid_until) : null,
    })),
  });
}

// Заявка на разряд: учитывается в рейтинге после проверки организатором, как на сайте.
export function submitRank(ctx) {
  if (!needAthlete(ctx)) return;
  const r = {
    rank_id: Number(ctx.body.rankId) || null,
    assigned_at: text(ctx.body.assignedAt, 10),
    valid_until: text(ctx.body.validUntil, 10) || null,
    order_number: text(ctx.body.orderNumber, 60) || null,
  };
  const errors = validateRank(r);
  if (Object.keys(errors).length) {
    const map = { rank_id: 'rankId', assigned_at: 'assignedAt', valid_until: 'validUntil', order_number: 'orderNumber' };
    return fail(ctx, 400, Object.values(errors)[0], { fields: Object.fromEntries(Object.entries(errors).map(([k, v]) => [map[k] || k, v])) });
  }
  submitRankRequest(ctx.athlete.id, r);
  ctx.json({ ok: true, message: 'Разряд отправлен на проверку. Бонус появится в рейтинге после подтверждения.' }, 201);
}

export function saveProfile(ctx) {
  if (!needAthlete(ctx)) return;
  const b = ctx.body;
  const values = {
    last_name: text(b.lastName, 100),
    first_name: text(b.firstName, 100),
    middle_name: text(b.middleName, 100) || null,
    birth_date: text(b.birthDate, 10) || null,
    municipality_id: Number(b.municipalityId) || null,
    organization_id: Number(b.organizationId) || null,
    is_public: b.isPublic === false ? 0 : 1,
    disciplineIds: (Array.isArray(b.disciplineIds) ? b.disciplineIds : []).map(Number).filter(Boolean),
  };
  const errors = validateProfile(values);
  if (Object.keys(errors).length) {
    const map = { last_name: 'lastName', first_name: 'firstName', birth_date: 'birthDate', municipality_id: 'municipalityId', organization_id: 'organizationId' };
    return fail(ctx, 400, Object.values(errors)[0], { fields: Object.fromEntries(Object.entries(errors).map(([k, v]) => [map[k] || k, v])) });
  }
  updateAthleteProfile(ctx.athlete.id, values);
  ctx.athlete = athleteByUser(ctx.user.id);
  ctx.json({ ok: true, message: 'Профиль сохранён. Теперь можно подавать заявки.', me: meDto(ctx) });
}

// ---------- чаты участников ----------

export function chats(ctx) {
  if (!needUser(ctx)) return;
  ctx.json({
    items: userChats(ctx.user).map((c) => ({
      competitionId: c.competition_id,
      title: c.title,
      status: c.status,
      statusLabel: STATUS_LABELS[c.status],
      dates: fmtRange(c.start_date, c.end_date),
      members: c.members,
      unread: c.unread,
      isHackathon: Boolean(get("SELECT 1 AS x FROM competition_events e JOIN disciplines d ON d.id = e.discipline_id WHERE e.competition_id = ? AND d.code = 'PRODUCT'", c.competition_id)) || hasSchedule(c.competition_id),
      last: c.last ? { ...messageDto(c.last, ctx.user), preview: c.last.body.length > 120 ? `${c.last.body.slice(0, 120)}…` : c.last.body } : null,
    })),
    hint: ctx.isOrganizer
      ? 'Чат соревнования появляется, когда вы допускаете первого участника.'
      : 'Чат хакатона появится здесь, когда организатор одобрит вашу заявку.',
  });
}

function loadChat(ctx) {
  if (!needUser(ctx)) return null;
  const opened = openChat(ctx.user, idParam(ctx));
  if (!opened) {
    fail(ctx, 403, 'Чат доступен участникам, чью заявку одобрил организатор', { code: 'chat' });
    return null;
  }
  return opened;
}

export function chat(ctx) {
  const opened = loadChat(ctx);
  if (!opened) return;
  const { chat: ch, competition: c } = opened;
  const messages = listMessages(ch.id, { limit: 60 });
  if (messages.length) markRead(ch.id, ctx.user.id, messages[messages.length - 1].id);
  ctx.json({
    competitionId: c.id,
    title: c.title,
    status: c.status,
    statusLabel: STATUS_LABELS[c.status],
    dates: fmtRange(c.start_date, c.end_date),
    members: athleteMembersCount(ch.id),
    memberList: chatMembers(ch.id),
    isOrganizer: ctx.isOrganizer,
    now: scheduleNowDto(c.id),
    messages: messages.map((m) => messageDto(m, ctx.user)),
    hasMore: messages.length === 60,
  });
}

export function chatMessages(ctx) {
  const opened = loadChat(ctx);
  if (!opened) return;
  const after = Number(ctx.query.get('after')) || 0;
  const before = Number(ctx.query.get('before')) || 0;
  const messages = listMessages(opened.chat.id, { after, before, limit: 60 });
  if (!before && messages.length) markRead(opened.chat.id, ctx.user.id, messages[messages.length - 1].id);
  ctx.json({
    items: messages.map((m) => messageDto(m, ctx.user)),
    hasMore: Boolean(before) && messages.length === 60,
    members: athleteMembersCount(opened.chat.id),
    now: scheduleNowDto(opened.competition.id),
  });
}

export function sendMessage(ctx) {
  if (!needUser(ctx)) return;
  const r = postMessage(ctx.user, idParam(ctx), ctx.body.body);
  if (r.error) return fail(ctx, 400, r.error);
  ctx.json({ ok: true, message: messageDto(r.message, ctx.user) }, 201);
}

// ---------- организатор: модерация заявок и расписание ----------

export function adminOverview(ctx) {
  if (!needOrganizer(ctx)) return;
  const list = listCompetitions({ includeDrafts: true }).filter((c) => ['DRAFT', 'PUBLISHED', 'ONGOING'].includes(c.status));
  const rows = list.map((c) => {
    const regs = competitionRegistrations(c.id);
    return {
      ...competitionCard(c),
      pending: regs.filter((r) => r.status === 'SUBMITTED').length,
      approved: regs.filter((r) => r.status === 'APPROVED').length,
      scheduleItems: listSchedule(c.id).length,
      next: scheduleNowDto(c.id).next,
    };
  });
  rows.sort((a, b) => b.pending - a.pending || (a.status === 'ONGOING' ? -1 : 0) - (b.status === 'ONGOING' ? -1 : 0));
  ctx.json({
    pendingTotal: rows.reduce((s, r) => s + r.pending, 0),
    items: rows,
  });
}

export function adminRegistrations(ctx) {
  if (!needOrganizer(ctx)) return;
  const c = getCompetition(idParam(ctx));
  if (!c) return fail(ctx, 404, 'Соревнование не найдено');
  const regs = competitionRegistrations(c.id);
  const order = { SUBMITTED: 0, APPROVED: 1, REJECTED: 2, WITHDRAWN: 3 };
  ctx.json({
    competition: competitionCard(c),
    counts: Object.fromEntries(Object.keys(REG_STATUS_LABELS).map((s) => [s, regs.filter((r) => r.status === s).length])),
    items: regs
      .slice()
      .sort((a, b) => order[a.status] - order[b.status] || String(a.created_at).localeCompare(String(b.created_at)))
      .map((r) => ({
        id: r.id,
        athleteId: r.athlete_id,
        name: fullName(r),
        organization: r.organization,
        municipality: r.municipality,
        discipline: r.discipline_short,
        status: r.status,
        statusLabel: REG_STATUS_LABELS[r.status],
        createdAt: fmtDateTime(r.created_at),
        hasAccount: Boolean(r.user_id),
      })),
  });
}

export function adminRegistrationStatus(ctx) {
  if (!needOrganizer(ctx)) return;
  const status = text(ctx.body.status, 20);
  const r = setRegistrationStatus(idParam(ctx), status, ctx.user.id);
  if (r.error) return fail(ctx, 400, r.error);
  const messages = {
    APPROVED: r.chat === 'joined' ? 'Участник допущен и добавлен в чат. Ему пришло уведомление.' : 'Участник допущен.',
    REJECTED: 'Заявка отклонена, участник получил уведомление.',
    SUBMITTED: 'Заявка возвращена на рассмотрение.',
  };
  ctx.json({ ok: true, chat: r.chat || null, message: messages[status] });
}

function scheduleFail(ctx, errors) {
  fail(ctx, 400, Object.values(errors)[0], { fields: errors });
}

export function adminAddSchedule(ctx) {
  if (!needOrganizer(ctx)) return;
  const c = getCompetition(idParam(ctx));
  if (!c) return fail(ctx, 404, 'Соревнование не найдено');
  const item = readScheduleInput(ctx.body);
  const errors = validateScheduleItem(item);
  if (Object.keys(errors).length) return scheduleFail(ctx, errors);
  const id = addScheduleItem(c.id, item, ctx.user.id);
  const saved = listSchedule(c.id).find((s) => s.id === id);
  ctx.json({ ok: true, item: scheduleDto(saved), message: c.status === 'ONGOING' ? 'Пункт добавлен. Участники получат уведомление в момент начала.' : 'Пункт добавлен. Уведомления начнут приходить, когда соревнование начнётся.' }, 201);
}

export function adminUpdateSchedule(ctx) {
  if (!needOrganizer(ctx)) return;
  const item = readScheduleInput(ctx.body);
  const errors = validateScheduleItem(item);
  if (Object.keys(errors).length) return scheduleFail(ctx, errors);
  const r = updateScheduleItem(idParam(ctx), item, ctx.user.id);
  if (r.error) return fail(ctx, 404, r.error);
  ctx.json({ ok: true, item: scheduleDto(listSchedule(r.competitionId).find((s) => s.id === idParam(ctx))) });
}

export function adminDeleteSchedule(ctx) {
  if (!needOrganizer(ctx)) return;
  if (!getScheduleItem(idParam(ctx))) return fail(ctx, 404, 'Пункт расписания не найден');
  deleteScheduleItem(idParam(ctx), ctx.user.id);
  ctx.json({ ok: true });
}
