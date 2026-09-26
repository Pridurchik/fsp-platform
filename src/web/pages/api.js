// Открытый API только для чтения: сайт школы, Telegram-бот или мобильное приложение
// могут брать отсюда соревнования и рейтинг, не трогая базу напрямую.
import { listCompetitions, getCompetition, eventsOf, registrationInfo, PHASES, STATUS_LABELS } from '../../modules/competitions.js';
import { publishedResults } from '../../modules/results.js';
import { leaderboard, athleteRating } from '../../modules/rating/service.js';
import { disciplineByCode } from '../../modules/dictionaries.js';
import { getAthlete } from '../../modules/athletes.js';
import { fullName } from '../../core/format.js';

const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;

function competitionDto(c) {
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
    url: `/competitions/${c.id}`,
  };
}

export function index(ctx) {
  ctx.json({
    name: 'ФСП РД API',
    version: '1',
    endpoints: {
      'GET /api/v1/competitions?tab=upcoming|current|finished': 'Список соревнований',
      'GET /api/v1/competitions/:id': 'Карточка соревнования с итогами',
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

export function rating(ctx) {
  const discipline = disciplineByCode(ctx.query.get('d'));
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
