// Эталоны из документа-плана (раздел 4). Запуск: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG as cfg, kPlace, kField, kTime, computeRating } from './engine.js';
import { addDays, addMonths } from '../../core/dates.js';

const near = (actual, expected, eps = 0.05) =>
  assert.ok(Math.abs(actual - expected) <= eps, `ожидали ${expected}, получили ${actual}`);

const AS_OF = '2026-09-25';
// Результат ровно N полных месяцев назад
const monthsAgo = (n) => addDays(addMonths(AS_OF, -n), -3);

const result = (level, basePoints, place, participants, months) => ({
  competitionId: months * 1000 + place,
  competitionTitle: level,
  levelName: level,
  levelShort: level,
  basePoints,
  disciplineId: 1,
  disciplineName: 'Алгоритмическое',
  place,
  participants,
  date: monthsAgo(months),
});

test('коэффициент места: крутая шкала наверху, около 10 % за последнее место', () => {
  near(kPlace(1, 50), 1, 1e-9);
  near(kPlace(2, 50), 0.873, 0.001);
  near(kPlace(3, 50), 0.82, 0.001);
  near(kPlace(10, 50), 0.618, 0.001);
  near(kPlace(50, 50), 0.109, 0.001);
});

test('коэффициент масштаба: победа среди 5 весит меньше, чем среди 50', () => {
  near(kField(1), 0.6, 1e-9);
  near(kField(5), 0.765, 0.001);
  near(kField(20), 0.906, 0.001);
  near(kField(50), 1, 1e-9);
  near(kField(120), 1, 1e-9);
});

test('коэффициент давности: 12 месяцев полный вес, к 24 месяцам ноль', () => {
  assert.equal(kTime(12, cfg), 1);
  assert.equal(kTime(15, cfg), 0.75);
  assert.equal(kTime(18, cfg), 0.5);
  assert.equal(kTime(24, cfg), 0);
  assert.equal(kTime(27, cfg), 0);
});

test('эталон из плана: спортсмен А (КМС) = 1443,9', () => {
  const r = computeRating(
    [
      result('ЧР', 1000, 18, 120, 8),
      result('ЧРД', 300, 1, 34, 3),
      result('Межрег', 400, 4, 60, 15),
      result('Регион', 150, 2, 12, 2),
      result('ЧРД-2024', 300, 2, 30, 27),
    ],
    { name: 'Кандидат в мастера спорта', shortName: 'КМС', bonus: 160 },
    cfg,
    AS_OF,
  );
  near(r.total, 1443.9);
  assert.equal(r.counted.length, 4);
  assert.equal(r.excluded.length, 1);
  assert.equal(r.excluded[0].reason, 'expired');
  near(r.counted[0].points, 661.3);
});

test('в зачёт идут только 5 лучших результатов', () => {
  const eight = Array.from({ length: 8 }, (_, i) => result('Школьный', 150, 1, 6, i + 1));
  const r = computeRating(eight, null, cfg, AS_OF);
  assert.equal(r.counted.length, 5);
  assert.equal(r.excluded.filter((l) => l.reason === 'outside').length, 3);
  near(r.total, 587.4);
});

test('1-е место из 20 на Кубке РД даёт 271,9', () => {
  const r = computeRating([result('КРД', 300, 1, 20, 0)], null, cfg, AS_OF);
  near(r.total, 271.9);
});

test('звание без стартов держит уровень: МС = 300', () => {
  const r = computeRating([result('ЧР', 1000, 3, 120, 26)], { name: 'Мастер спорта России', shortName: 'МС', bonus: 300 }, cfg, AS_OF);
  near(r.total, 300, 1e-9);
});

test('результат из будущего не учитывается', () => {
  const future = { ...result('КРД', 300, 1, 20, 0), date: addDays(AS_OF, 5) };
  assert.equal(computeRating([future], null, cfg, AS_OF).total, 0);
});
