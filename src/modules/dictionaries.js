// Справочники: уровни с базовыми баллами, разряды с бонусами, дисциплины, города, организации.
import { all, get, run, tx } from '../db/index.js';

export const ORG_KINDS = { SCHOOL: 'Школа', COLLEGE: 'Колледж', UNIVERSITY: 'Вуз', CLUB: 'Центр доп. образования' };
export const RANK_KINDS = { YOUTH: 'Юношеский разряд', RANK: 'Спортивный разряд', TITLE: 'Спортивное звание' };
export const MUNICIPALITY_KINDS = { CITY: 'Город', DISTRICT: 'Район' };

// Короткие описания пяти дисциплин вида спорта. У дисциплин, добавленных вручную, описания нет.
export const DISCIPLINE_INFO = {
  ALGO: 'Олимпиадные задачи на время: алгоритмы, структуры данных, математика.',
  PRODUCT: 'Команда за ограниченное время делает работающий прототип продукта по кейсу.',
  SECURITY: 'Соревнования формата CTF: поиск уязвимостей и защита информационных систем.',
  UAV: 'Программирование автономного полёта беспилотника по заданной миссии.',
  ROBOTICS: 'Программирование роботов, которые выполняют задания на полигоне.',
};

export const listDisciplines = () => all('SELECT * FROM disciplines ORDER BY sort_order, id');
export const listLevels = () => all('SELECT * FROM competition_levels ORDER BY sort_order, id');
export const listRanks = () => all('SELECT * FROM ranks ORDER BY sort_order, id');
export const listTags = () => all('SELECT * FROM tags ORDER BY sort_order, name');
export const listLanguages = () => all('SELECT * FROM languages ORDER BY sort_order, name');
export const listMunicipalities = () => all("SELECT * FROM municipalities ORDER BY kind = 'DISTRICT', name");
export const listOrganizations = () =>
  all(
    `SELECT o.*, m.name AS municipality FROM organizations o
       LEFT JOIN municipalities m ON m.id = o.municipality_id
      ORDER BY m.name, o.name`,
  );

export const disciplineByCode = (code) => (code ? get('SELECT * FROM disciplines WHERE code = ?', code) : null);
export const levelByCode = (code) => (code ? get('SELECT * FROM competition_levels WHERE code = ?', code) : null);

const intOr = (v, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};
const text = (v) => String(v ?? '').trim();

// Обновление строк справочника из формы вида field_<id>
export function updateLevels(form) {
  tx(() => {
    for (const l of listLevels()) {
      const name = text(form.get(`name_${l.id}`)) || l.name;
      const short = text(form.get(`short_${l.id}`)) || l.short_name;
      const points = Math.max(0, intOr(form.get(`points_${l.id}`), l.base_points));
      run('UPDATE competition_levels SET name = ?, short_name = ?, base_points = ? WHERE id = ?', name, short, points, l.id);
    }
  });
}

export function updateRanks(form) {
  tx(() => {
    for (const r of listRanks()) {
      const name = text(form.get(`name_${r.id}`)) || r.name;
      const short = text(form.get(`short_${r.id}`)) || r.short_name;
      const bonus = Math.max(0, intOr(form.get(`bonus_${r.id}`), r.bonus_points));
      run('UPDATE ranks SET name = ?, short_name = ?, bonus_points = ? WHERE id = ?', name, short, bonus, r.id);
    }
  });
}

export function updateDisciplines(form) {
  tx(() => {
    for (const d of listDisciplines()) {
      const name = text(form.get(`name_${d.id}`)) || d.name;
      const short = text(form.get(`short_${d.id}`)) || d.short_name;
      run('UPDATE disciplines SET name = ?, short_name = ? WHERE id = ?', name, short, d.id);
    }
  });
}

export function addLevel(name, shortName, points) {
  const code = `L${Date.now().toString(36).toUpperCase()}`;
  const order = get('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM competition_levels').n;
  run(
    'INSERT INTO competition_levels (code, name, short_name, base_points, sort_order) VALUES (?, ?, ?, ?, ?)',
    code, name, shortName || name, Math.max(0, intOr(points, 0)), order,
  );
}

export function addDiscipline(name, shortName) {
  const code = `D${Date.now().toString(36).toUpperCase()}`;
  const order = get('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM disciplines').n;
  run('INSERT INTO disciplines (code, name, short_name, sort_order) VALUES (?, ?, ?, ?)', code, name, shortName || name, order);
}

export function addMunicipality(name, kind) {
  if (get('SELECT id FROM municipalities WHERE name = ?', name)) return { error: 'Такой населённый пункт уже есть' };
  run('INSERT INTO municipalities (name, kind) VALUES (?, ?)', name, kind === 'DISTRICT' ? 'DISTRICT' : 'CITY');
  return { ok: true };
}

export function addOrganization(name, kind, municipalityId) {
  run(
    'INSERT INTO organizations (name, kind, municipality_id) VALUES (?, ?, ?)',
    name,
    ORG_KINDS[kind] ? kind : 'SCHOOL',
    municipalityId || null,
  );
  return { ok: true };
}
