// Действия спортсмена с командами соревнования.
import { html } from '../../core/html.js';
import { getCompetition } from '../../modules/competitions.js';
import { createTeam as createTeamFn, joinTeamByCode, leaveTeam as leaveTeamFn } from '../../modules/teams.js';
import { requireAthlete } from '../guards.js';

function backTo(ctx, id) {
  return `/competitions/${id}#participation`;
}

function finish(ctx, id, result, success) {
  const target = backTo(ctx, id);
  if (result.error === 'profile') {
    return ctx.redirect(`/cabinet/profile?next=${encodeURIComponent(`/competitions/${id}`)}`, {
      type: 'info', text: 'Заполните населённый пункт и организацию в профиле, чтобы участвовать.',
    });
  }
  if (result.error) return ctx.redirect(target, { type: 'error', text: result.error });
  return ctx.redirect(target, success);
}

export function create(ctx) {
  if (!requireAthlete(ctx)) return;
  const id = Number(ctx.params.id);
  if (!getCompetition(id)) return ctx.html('Соревнование не найдено', 404);
  return finish(ctx, id, createTeamFn(ctx.athlete, id, ctx.form.get('name')), 'Команда создана. Код приглашения показан на странице соревнования.');
}

export function join(ctx) {
  if (!requireAthlete(ctx)) return;
  const id = Number(ctx.params.id);
  const result = joinTeamByCode(ctx.athlete, ctx.form.get('code'), id);
  return finish(ctx, id, result, 'Вы вступили в команду.');
}

export function leave(ctx) {
  if (!requireAthlete(ctx)) return;
  const id = Number(ctx.params.id);
  const result = leaveTeamFn(ctx.athlete, Number(ctx.form.get('team_id')));
  return finish(ctx, result.competitionId || id, result, 'Вы вышли из команды.');
}
