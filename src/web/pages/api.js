// Открытый API только для чтения: сайт школы, Telegram-бот или мобильное приложение
// могут брать отсюда соревнования и рейтинг, не трогая базу напрямую.
import { listCompetitions, getCompetition, eventsOf, registrationInfo, PHASES, STATUS_LABELS } from '../../modules/competitions.js';
import { publishedResults } from '../../modules/results.js';
import { getContest, standings } from '../../modules/contests.js';
import { leaderboard, athleteRating } from '../../modules/rating/service.js';
import { disciplineByCode } from '../../modules/dictionaries.js';
import { getAthlete } from '../../modules/athletes.js';
import { fullName } from '../../core/format.js';
import { competitionMeta } from '../../modules/competitions.js';

const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;

function competitionDto(c) {
  const meta = competitionMeta(c.id);
  return {
    id: c.id,
    title: c.title,
    status: c.status,
    statusLabel: STATUS_LABELS[c.status],
    level: { code: c.level_code, name: c.level_name, basePoints: c.base_points },
    format: c.format,
    city: c.city,
    venue: c.venue,
    startDate: c.start_date,
    endDate: c.end_date,
    registration: { start: c.reg_start, end: c.reg_end, open: registrationInfo(c).open },
    disciplines: (c.events || eventsOf(c.id)).map((e) => ({ code: e.discipline_code, name: e.discipline_name, registered: e.registered })),
    organizer: c.organizer_name || null,
    organizerContacts: c.organizer_contacts || null,
    description: c.description || null,
    eventUrl: c.event_url || null,
    rules: c.rules_text || null,
    prizeFund: c.prize_fund || null,
    age: { min: c.age_min, max: c.age_max },
    team: { minSize: c.min_team_size, maxSize: c.max_team_size, allowIndividual: Boolean(c.allow_individual) },
    tags: meta.tags.map((x) => ({ code: x.code, name: x.name })),
    languages: meta.languages.map((x) => ({ code: x.code, name: x.name })),
    url: `/competitions/${c.id}`,
  };
}

export function index(ctx) {
  ctx.json({
    name: 'ФСП РД API',
    version: '1',
    docs: '/api/docs',
    openapi: '/api/openapi.json',
    endpoints: {
      'GET /api/v1/competitions?tab=upcoming|current|finished': 'Список соревнований',
      'GET /api/v1/competitions/:id': 'Карточка соревнования с итогами',
      'GET /api/v1/competitions/:id/standings': 'Таблица контеста на платформе',
      'GET /api/v1/rating?d=ALGO|PRODUCT|SECURITY|UAV|ROBOTICS': 'Рейтинг, общий или по дисциплине',
      'GET /api/v1/athletes/:id': 'Публичный профиль и разбор рейтинга',
    },
  });
}

export function competitions(ctx) {
  const tab = PHASES[ctx.query.get('tab')] ? ctx.query.get('tab') : null;
  const list = tab ? listCompetitions({ phase: tab }) : listCompetitions({});
  ctx.json({ count: list.length, items: list.map(competitionDto) });
}

export function competition(ctx) {
  const c = getCompetition(Number(ctx.params.id));
  if (!c || c.status === 'DRAFT') return ctx.json({ error: 'Соревнование не найдено' }, 404);
  const dto = competitionDto({ ...c, events: eventsOf(c.id) });
  if (c.status === 'RESULTS_PUBLISHED') {
    dto.results = publishedResults(c.id).map((r) => ({
      discipline: r.event.discipline_code,
      participants: r.participants,
      rows: r.rows.map((row) => ({
        place: row.place,
        athleteId: row.is_public ? row.athlete_id : null,
        name: row.is_public ? fullName(row) : null,
        organization: row.organization,
        score: row.score,
        ratingPoints: round1(row.points),
      })),
    }));
  }
  ctx.json(dto);
}

export function rating(ctx) {  const discipline = disciplineByCode(ctx.query.get('d'));
  const board = leaderboard({ disciplineId: discipline?.id || null });
  ctx.json({
    asOf: board.asOf,
    discipline: discipline ? discipline.code : 'ALL',
    count: board.rows.length,
    items: board.rows.map((r) => ({
      position: r.position,
      athleteId: r.athlete.is_public ? r.athlete.id : null,
      name: r.athlete.is_public ? fullName(r.athlete) : null,
      municipality: r.athlete.municipality,
      organization: r.athlete.organization,
      qualification: r.rating.qualification?.shortName || null,
      rating: round1(r.rating.total),
      counted: r.rating.counted.length,
    })),
  });
}

export function athlete(ctx) {
  const a = getAthlete(Number(ctx.params.id));
  if (!a || !a.is_public) return ctx.json({ error: 'Профиль не найден или скрыт' }, 404);
  const { rating, position, of, cfg } = athleteRating(a.id);
  ctx.json({
    id: a.id,
    name: fullName(a),
    municipality: a.municipality,
    organization: a.organization,
    rating: round1(rating.total),
    position,
    of,
    method: { version: cfg.version, topN: cfg.topN, windowMonths: cfg.windowMonths },
    qualification: rating.qualification ? { name: rating.qualification.name, bonus: rating.qualification.bonus } : null,
    counted: rating.counted.map((l) => ({
      competitionId: l.competitionId,
      title: l.competitionTitle,
      date: l.date,
      place: l.place,
      participants: l.participants,
      basePoints: l.basePoints,
      kPlace: round3(l.kPlace),
      kField: round3(l.kField),
      kTime: round3(l.kTime),
      points: round1(l.points),
    })),
  });
}

// Таблица контеста на платформе: та же логика, что на странице соревнования.
export function standingsTable(ctx) {
  const c = getCompetition(Number(ctx.params.id));
  if (!c || c.status === 'DRAFT') return ctx.json({ error: 'Соревнование не найдено' }, 404);
  const k = getContest(c.id);
  if (!k?.on_platform) return ctx.json({ error: 'Это не контест на платформе' }, 404);
  const s = standings(c.id);
  ctx.json({
    competitionId: c.id,
    title: c.title,
    status: c.status,
    final: c.status === 'RESULTS_PUBLISHED',
    tasks: s.tasks.map((t) => ({ id: t.id, letter: t.letter, title: t.title, maxScore: t.max_score })),
    rows: s.rows.map((r) => ({
      place: r.place,
      athleteId: r.athlete.is_public ? r.athleteId : null,
      name: r.athlete.is_public ? fullName(r.athlete) : null,
      organization: r.athlete.organization,
      total: r.total,
      pending: r.pending,
      cells: s.tasks.map((t) => {
        const cell = r.cells.get(t.id);
        return cell ? { best: cell.best, attempts: cell.attempts, pending: cell.pending } : null;
      }),
    })),
  });
}
