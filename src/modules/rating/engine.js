// Движок рейтинга ФСП РД. Чистые функции: ни базы, ни HTTP — поэтому легко тестировать.
//
//   R = сумма topN лучших P за windowMonths + Q
//   P = B × Kм × KN × Kt
//   Kм = 1 − (1 − placeFloor) · ((m − 1) / N)^placePower      место m из N
//   KN = min(1, fieldMin + (1 − fieldMin) · ln N / ln fieldRef)  масштаб
//   Kt = 1 до fullMonths, затем линейно до 0 к windowMonths      давность
//   Q  = бонус подтверждённого действующего разряда или звания

import { monthsBetween } from '../../core/dates.js';

export const DEFAULT_CONFIG = Object.freeze({
  topN: 5,
  windowMonths: 24,
  fullMonths: 12,
  placeFloor: 0.1,
  placePower: 0.5,
  fieldRef: 50,
  fieldMin: 0.6,
});

export function kPlace(place, participants, cfg = DEFAULT_CONFIG) {
  const n = Math.max(1, Math.trunc(participants) || 1);
  const m = Math.min(Math.max(1, Math.trunc(place) || 1), n);
  return 1 - (1 - cfg.placeFloor) * Math.pow((m - 1) / n, cfg.placePower);
}

export function kField(participants, cfg = DEFAULT_CONFIG) {
  const n = Math.max(1, Math.trunc(participants) || 1);
  return Math.min(1, cfg.fieldMin + (1 - cfg.fieldMin) * (Math.log(n) / Math.log(cfg.fieldRef)));
}

export function kTime(ageMonths, cfg = DEFAULT_CONFIG) {
  if (ageMonths <= cfg.fullMonths) return 1;
  const span = cfg.windowMonths - cfg.fullMonths;
  if (span <= 0) return 0;
  return Math.max(0, 1 - (ageMonths - cfg.fullMonths) / span);
}

/**
 * @param {Array<{competitionId:number, competitionTitle:string, levelName:string, levelShort:string,
 *   basePoints:number, disciplineId:number, disciplineName:string, place:number, participants:number, date:string}>} results
 * @param {{name:string, shortName:string, bonus:number}|null} qualification
 * @param {typeof DEFAULT_CONFIG} cfg
 * @param {string} asOf дата расчёта ГГГГ-ММ-ДД
 */
export function computeRating(results, qualification, cfg = DEFAULT_CONFIG, asOf) {
  const lines = [];
  for (const r of results) {
    if (!r.place || r.date > asOf) continue;
    const ageMonths = Math.max(0, monthsBetween(r.date, asOf));
    const kp = kPlace(r.place, r.participants, cfg);
    const kf = kField(r.participants, cfg);
    const kt = kTime(ageMonths, cfg);
    lines.push({ ...r, ageMonths, kPlace: kp, kField: kf, kTime: kt, points: r.basePoints * kp * kf * kt });
  }

  const byPoints = (a, b) => b.points - a.points || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const live = lines.filter((l) => l.points > 0).sort(byPoints);
  const counted = live.slice(0, cfg.topN).map((l) => ({ ...l, counted: true, reason: null }));
  const outside = live.slice(cfg.topN).map((l) => ({ ...l, counted: false, reason: 'outside' }));
  const expired = lines
    .filter((l) => l.points <= 0)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((l) => ({ ...l, counted: false, reason: 'expired' }));

  const resultsPoints = counted.reduce((sum, l) => sum + l.points, 0);
  const bonus = qualification ? qualification.bonus : 0;
  const lastDate = counted.reduce((d, l) => (d && d > l.date ? d : l.date), null);

  return {
    total: resultsPoints + bonus,
    resultsPoints,
    bonus,
    qualification: qualification || null,
    counted,
    excluded: [...outside, ...expired],
    bestSingle: counted.length ? counted[0].points : 0,
    lastDate,
  };
}

// Порядок в таблице: рейтинг, затем лучший одиночный результат, затем более свежий.
export function compareRatings(a, b) {
  return (
    b.total - a.total ||
    b.bestSingle - a.bestSingle ||
    String(b.lastDate || '').localeCompare(String(a.lastDate || ''))
  );
}
