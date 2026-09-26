// Допуск спортсмена на соревнование: возраст и требуемый разряд.
// Профиль (населённый пункт и организация) проверяется отдельно в registrations.
import { get } from '../db/index.js';
import { ageYears, todayISO } from '../core/dates.js';

// Пресеты для формы соревнования: ключ → границы. Хранятся числами age_min/age_max.
export const AGE_PRESETS = [
  { key: 'any', label: 'Без ограничений', min: null, max: null },
  { key: 'u18', label: 'До 18 лет', min: null, max: 17 },
  { key: 'adult', label: '18+', min: 18, max: null },
  { key: 'teen', label: '14–18 лет', min: 14, max: 18 },
  { key: 'custom', label: 'Свой диапазон', min: 'custom', max: 'custom' },
];

// null — допущен, иначе { code, error }. code 'birthdate' — отправить в профиль за датой рождения.
export function checkAgeAndRank(athlete, competition) {
  if (competition.age_min != null || competition.age_max != null) {
    const age = athlete.birth_date ? ageYears(athlete.birth_date) : null;
    if (!Number.isFinite(age)) {
      return { code: 'birthdate', error: 'Для этого соревнования нужна дата рождения. Укажите её в профиле.' };
    }
    if (competition.age_min != null && age < competition.age_min) {
      return { code: 'age', error: `Возрастное ограничение: от ${competition.age_min} лет` };
    }
    if (competition.age_max != null && age > competition.age_max) {
      return { code: 'age', error: `Возрастное ограничение: до ${competition.age_max} лет` };
    }
  }
  if (competition.required_rank_id) {
    const need = get('SELECT * FROM ranks WHERE id = ?', competition.required_rank_id);
    const have = need
      ? get(
          `SELECT MAX(r.sort_order) AS s FROM athlete_ranks ar JOIN ranks r ON r.id = ar.rank_id
            WHERE ar.athlete_id = ? AND ar.status = 'CONFIRMED' AND (ar.valid_until IS NULL OR ar.valid_until >= ?)`,
          athlete.id, todayISO(),
        )
      : null;
    if (!need || !have?.s || have.s < need.sort_order) {
      return { code: 'rank', error: `Нужен разряд не ниже «${need ? need.short_name : 'указанного'}»` };
    }
  }
  return null;
}
