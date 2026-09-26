// Рейтинг считается на лету из опубликованных результатов: данные и рейтинг не могут разъехаться.
import { all, get, run } from '../../db/index.js';
import { todayISO, addMonths, endOfMonth } from '../../core/dates.js';
import { DEFAULT_CONFIG, computeRating, compareRatings } from './engine.js';

export function getRatingConfig() {
  const r = get('SELECT * FROM rating_config WHERE id = 1');
  if (!r) return { ...DEFAULT_CONFIG, version: '1.0' };
  return {
    version: r.version,
    topN: r.top_n,
    windowMonths: r.window_months,
    fullMonths: r.full_months,
    placeFloor: r.place_floor,
    placePower: r.place_power,
    fieldRef: r.field_ref,
    fieldMin: r.field_min,
  };
}

export function saveRatingConfig(c) {
  run(
    `INSERT INTO rating_config (id, version, top_n, window_months, full_months, place_floor, place_power, field_ref, field_min, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET version = excluded.version, top_n = excluded.top_n, window_months = excluded.window_months,
       full_months = excluded.full_months, place_floor = excluded.place_floor, place_power = excluded.place_power,
       field_ref = excluded.field_ref, field_min = excluded.field_min, updated_at = excluded.updated_at`,
    c.version, c.topN, c.windowMonths, c.fullMonths, c.placeFloor, c.placePower, c.fieldRef, c.fieldMin,
  );
}

const RESULTS_SQL = `
  SELECT r.id AS resultId, r.athlete_id AS athleteId, r.place AS place,
         e.id AS eventId, e.discipline_id AS disciplineId, d.short_name AS disciplineName,
         c.id AS competitionId, c.title AS competitionTitle, c.end_date AS date,
         l.name AS levelName, l.short_name AS levelShort, l.base_points AS basePoints,
         COALESCE(e.participants_total,
                  (SELECT COUNT(*) FROM results r2 WHERE r2.event_id = e.id AND r2.place IS NOT NULL)) AS participants
    FROM results r
    JOIN competition_events e ON e.id = r.event_id
    JOIN competitions c ON c.id = e.competition_id
    JOIN competition_levels l ON l.id = c.level_id
    JOIN disciplines d ON d.id = e.discipline_id
   WHERE r.place IS NOT NULL
     AND ((c.status = 'RESULTS_PUBLISHED' AND c.id <> ?) OR c.id = ?)`;

// include — посчитать так, будто итоги этого соревнования уже опубликованы; exclude — будто ещё нет.
export function loadResults({ include = -1, exclude = -1, athleteId = null } = {}) {
  if (athleteId) return all(`${RESULTS_SQL} AND r.athlete_id = ?`, exclude, include, athleteId);
  return all(RESULTS_SQL, exclude, include);
}

export function qualificationsMap(asOf = todayISO()) {
  const rows = all(
    `SELECT ar.athlete_id AS athleteId, rk.name, rk.short_name AS shortName, rk.kind, rk.bonus_points AS bonus, ar.valid_until AS validUntil
       FROM athlete_ranks ar JOIN ranks rk ON rk.id = ar.rank_id
      WHERE ar.status = 'CONFIRMED' AND ar.assigned_at <= ? AND (ar.valid_until IS NULL OR ar.valid_until >= ?)`,
    asOf,
    asOf,
  );
  const map = new Map();
  for (const r of rows) {
    const current = map.get(r.athleteId);
    if (!current || r.bonus > current.bonus) map.set(r.athleteId, r);
  }
  return map;
}

export function qualificationFor(athleteId, asOf = todayISO()) {
  return (
    get(
      `SELECT rk.name, rk.short_name AS shortName, rk.kind, rk.bonus_points AS bonus, ar.valid_until AS validUntil
         FROM athlete_ranks ar JOIN ranks rk ON rk.id = ar.rank_id
        WHERE ar.athlete_id = ? AND ar.status = 'CONFIRMED' AND ar.assigned_at <= ?
          AND (ar.valid_until IS NULL OR ar.valid_until >= ?)
        ORDER BY rk.bonus_points DESC LIMIT 1`,
      athleteId,
      asOf,
      asOf,
    ) || null
  );
}

// Рейтинг всех спортсменов: Map<athleteId, расчёт>
export function computeAll({ asOf = todayISO(), disciplineId = null, include = -1, exclude = -1, cfg = getRatingConfig() } = {}) {
  const results = loadResults({ include, exclude }).filter(
    (r) => r.date <= asOf && (!disciplineId || r.disciplineId === disciplineId),
  );
  const quals = qualificationsMap(asOf);
  const byAthlete = new Map();
  for (const r of results) {
    if (!byAthlete.has(r.athleteId)) byAthlete.set(r.athleteId, []);
    byAthlete.get(r.athleteId).push(r);
  }
  const ids = new Set([...byAthlete.keys(), ...(disciplineId ? [] : quals.keys())]);
  const out = new Map();
  for (const id of ids) out.set(id, computeRating(byAthlete.get(id) || [], quals.get(id) || null, cfg, asOf));
  return out;
}

// Места в таблице. В рейтинг дисциплины попадают те, у кого есть зачётный результат в ней.
export function positions(ratings, { disciplineId = null } = {}) {
  const list = [...ratings.entries()]
    .filter(([, r]) => r.total > 0 && (!disciplineId || r.counted.length > 0))
    .sort(([ida, a], [idb, b]) => compareRatings(a, b) || ida - idb);
  const map = new Map();
  list.forEach(([id], i) => map.set(id, i + 1));
  return map;
}

export function leaderboard({ asOf = todayISO(), disciplineId = null, municipalityId = null, q = '', limit = null } = {}) {
  const ratings = computeAll({ asOf, disciplineId });
  const pos = positions(ratings, { disciplineId });
  const athletes = all(
    `SELECT a.*, m.name AS municipality, o.name AS organization
       FROM athletes a
       LEFT JOIN municipalities m ON m.id = a.municipality_id
       LEFT JOIN organizations o ON o.id = a.organization_id`,
  );
  let rows = athletes
    .filter((a) => pos.has(a.id))
    .map((a) => ({ athlete: a, rating: ratings.get(a.id), position: pos.get(a.id) }))
    .sort((x, y) => x.position - y.position);
  const total = rows.length;
  if (municipalityId) rows = rows.filter((r) => r.athlete.municipality_id === municipalityId);
  if (q) {
    const needle = q.trim().toLowerCase();
    rows = rows.filter((r) =>
      [r.athlete.last_name, r.athlete.first_name, r.athlete.middle_name].join(' ').toLowerCase().includes(needle),
    );
  }
  return { rows: limit ? rows.slice(0, limit) : rows, total, asOf };
}

export function athleteRating(athleteId, { asOf = todayISO(), disciplineId = null } = {}) {
  const cfg = getRatingConfig();
  const ratings = computeAll({ asOf, disciplineId, cfg });
  const pos = positions(ratings, { disciplineId });
  const rating =
    ratings.get(athleteId) || computeRating([], disciplineId ? null : qualificationFor(athleteId, asOf), cfg, asOf);
  return { rating, position: pos.get(athleteId) || null, of: pos.size, cfg, asOf };
}

// История: та же формула на конец каждого из последних месяцев.
export function ratingHistory(athleteId, months = 12) {
  const cfg = getRatingConfig();
  const today = todayISO();
  const results = loadResults({ athleteId });
  const points = [];
  for (let i = months; i >= 1; i--) {
    const date = endOfMonth(addMonths(today, -i));
    points.push({ date, total: computeRating(results, qualificationFor(athleteId, date), cfg, date).total });
  }
  points.push({ date: today, total: computeRating(results, qualificationFor(athleteId, today), cfg, today).total });
  return points;
}

// Как изменится рейтинг участников при публикации итогов соревнования.
export function ratingDiff(competitionId, { alreadyPublished = false, asOf = todayISO() } = {}) {
  const cfg = getRatingConfig();
  const before = alreadyPublished
    ? computeAll({ asOf, exclude: competitionId, cfg })
    : computeAll({ asOf, cfg });
  const after = alreadyPublished
    ? computeAll({ asOf, cfg })
    : computeAll({ asOf, include: competitionId, cfg });
  const posBefore = positions(before);
  const posAfter = positions(after);
  const participants = all(
    `SELECT r.athlete_id AS athleteId, MIN(r.place) AS bestPlace
       FROM results r JOIN competition_events e ON e.id = r.event_id
      WHERE e.competition_id = ? AND r.place IS NOT NULL
      GROUP BY r.athlete_id`,
    competitionId,
  );
  return participants
    .map((p) => ({
      athleteId: p.athleteId,
      bestPlace: p.bestPlace,
      before: before.get(p.athleteId)?.total || 0,
      after: after.get(p.athleteId)?.total || 0,
      positionBefore: posBefore.get(p.athleteId) || null,
      positionAfter: posAfter.get(p.athleteId) || null,
    }))
    .sort((a, b) => a.bestPlace - b.bestPlace);
}

export function lastRatingChange(athleteId) {
  return get(
    `SELECT rc.*, c.title AS competition_title
       FROM rating_changes rc JOIN competitions c ON c.id = rc.competition_id
      WHERE rc.athlete_id = ? ORDER BY rc.created_at DESC, rc.id DESC LIMIT 1`,
    athleteId,
  );
}
