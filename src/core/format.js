const nf1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf3 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmt1 = (n) => nf1.format(Number(n) || 0);
export const fmtInt = (n) => nf0.format(Number(n) || 0);
export const fmtK = (n) => nf3.format(Number(n) || 0);
export const fmtK2 = (n) => nf2.format(Number(n) || 0);

// Изменение со знаком: +94,8 / −12,0
export function signed(n) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  if (v === 0) return '0,0';
  return (v > 0 ? '+' : '−') + nf1.format(Math.abs(v));
}

// plural(5, ['спортсмен', 'спортсмена', 'спортсменов']) → 'спортсменов'
export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

export const countOf = (n, forms) => `${fmtInt(n)} ${plural(n, forms)}`;

export function fullName(a) {
  if (!a) return '';
  return [a.last_name, a.first_name, a.middle_name].filter(Boolean).join(' ');
}

export function shortName(a) {
  if (!a) return '';
  return `${a.last_name} ${a.first_name}`;
}

export function initials(a) {
  if (!a) return '';
  return `${(a.first_name || '').charAt(0)}${(a.last_name || '').charAt(0)}`.toUpperCase();
}
