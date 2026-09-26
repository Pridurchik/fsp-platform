// Карта сайта. Новый раздел — одна строка здесь и обработчик в web/pages.
import * as pub from './web/pages/public.js';
import * as auth from './web/pages/auth.js';
import * as cabinet from './web/pages/cabinet.js';
import * as admin from './web/pages/admin.js';
import * as api from './web/pages/api.js';
import * as docs from './web/pages/docs.js';
import * as contest from './web/pages/contests.js';
import * as teams from './web/pages/teams.js';
import * as hackathon from './web/pages/hackathon.js';
import * as mobile from './web/pages/mobile.js';

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}/?$`);
  routes.push({ method, re, keys, handler });
}

// Публичная часть
route('GET', '/', pub.home);
route('GET', '/competitions', pub.competitions);
route('GET', '/competitions/:id', pub.competition);
route('POST', '/competitions/:id/apply', pub.apply);
route('POST', '/registrations/:id/withdraw', pub.withdraw);
route('GET', '/rating', pub.rating);
route('GET', '/rating/method', pub.method);
route('GET', '/athletes/:id', pub.athlete);
route('GET', '/calendar', pub.calendar);
route('GET', '/news', pub.newsList);
route('GET', '/news/:id', pub.newsItem);
route('GET', '/documents', pub.documents);
route('GET', '/about', pub.about);

// Модуль проведения соревнований (кейс №2): участие и отправка решений
route('POST', '/competitions/:id/join', contest.join);
route('POST', '/tasks/:id/submit', contest.submit);
route('POST', '/competitions/:id/team', teams.create);
route('POST', '/competitions/:id/team/join', teams.join);
route('POST', '/competitions/:id/team/leave', teams.leave);

// Хакатон: чат допущенных участников и расписание (организатор ведёт на вкладке соревнования)
route('GET', '/competitions/:id/chat', hackathon.chatPage);
route('POST', '/competitions/:id/chat', hackathon.sendChat);
route('GET', '/admin/competitions/:id/schedule', hackathon.schedule);
route('POST', '/admin/competitions/:id/schedule', hackathon.addSchedule);
route('POST', '/admin/schedule/:id/delete', hackathon.removeSchedule);

// Вход и регистрация
route('GET', '/login', auth.loginForm);
route('POST', '/login', auth.login);
route('GET', '/register', auth.registerForm);
route('POST', '/register', auth.register);
route('POST', '/logout', auth.logout);
route('POST', '/demo-login', auth.demoLogin);
route('GET', '/setup', auth.setupForm);
route('POST', '/setup', auth.setup);

// Кабинет спортсмена
route('GET', '/cabinet', cabinet.overview);
route('GET', '/cabinet/profile', cabinet.profileForm);
route('POST', '/cabinet/profile', cabinet.saveProfile);
route('POST', '/cabinet/rank', cabinet.submitRank);
route('POST', '/cabinet/notifications/read', cabinet.readNotifications);

// Кабинет организатора
route('GET', '/admin', admin.dashboard);
route('GET', '/admin/competitions', admin.competitions);
route('GET', '/admin/competitions/new', admin.newCompetition);
route('POST', '/admin/competitions', admin.createCompetition);
route('GET', '/admin/competitions/:id', admin.editCompetition);
route('POST', '/admin/competitions/:id', admin.updateCompetition);
route('POST', '/admin/competitions/:id/transition', admin.transition);
route('GET', '/admin/competitions/:id/participants', admin.participants);
route('GET', '/admin/competitions/:id/participants.csv', admin.participantsCsv);
route('POST', '/admin/registrations/:id/status', admin.registrationStatus);
route('GET', '/admin/competitions/:id/results', admin.results);
route('POST', '/admin/events/:id/results', admin.saveResults);
route('GET', '/admin/athletes', admin.athletes);
route('GET', '/admin/athletes/new', admin.newAthlete);
route('POST', '/admin/athletes', admin.createAthlete);
route('GET', '/admin/athletes/:id', admin.athleteCard);
route('POST', '/admin/athletes/:id/ranks', admin.assignRank);
route('POST', '/admin/athlete-ranks/:id/review', admin.reviewRank);
route('GET', '/admin/dictionaries', admin.dictionaries);
route('POST', '/admin/dictionaries/:type', admin.saveDictionary);
route('GET', '/admin/content', admin.content);
route('POST', '/admin/news', admin.createNews);
route('POST', '/admin/news/:id/delete', admin.deleteNews);
route('POST', '/admin/documents', admin.createDocument);
route('POST', '/admin/documents/:id/delete', admin.deleteDocument);
route('GET', '/admin/rating.csv', admin.ratingCsv);
route('GET', '/admin/settings', admin.settings);
route('POST', '/admin/settings', admin.saveSettings);

// Модуль проведения соревнований: задания и проверка решений
route('GET', '/admin/competitions/:id/tasks', contest.tasks);
route('POST', '/admin/competitions/:id/tasks', contest.addTask);
route('POST', '/admin/tasks/:id', contest.updateTask);
route('POST', '/admin/tasks/:id/delete', contest.deleteTask);
route('GET', '/admin/competitions/:id/submissions', contest.submissions);
route('POST', '/admin/submissions/:id/grade', contest.grade);
route('GET', '/admin/competitions/:id/protocol.csv', contest.protocolCsv);
route('GET', '/competitions/:id/protocol', contest.protocolPage);

// Открытый API для интеграций
route('GET', '/api/v1', api.index);
route('GET', '/api/openapi.json', docs.openapiJson);
route('GET', '/api/docs', docs.docsPage);
route('GET', '/api/v1/competitions', api.competitions);
route('GET', '/api/v1/competitions/:id', api.competition);
route('GET', '/api/v1/competitions/:id/standings', api.standingsTable);
route('GET', '/api/v1/rating', api.rating);
route('GET', '/api/v1/athletes/:id', api.athlete);

// API мобильного приложения: JSON, вход по токену (Authorization: Bearer). Обработка в app.js → handleMobile.
route('GET', '/api/mobile/config', mobile.config);
route('GET', '/api/mobile/health', mobile.health);
route('GET', '/api/mobile/events', mobile.events);
route('GET', '/api/events', mobile.webEvents);
route('POST', '/api/mobile/login', mobile.login);
route('POST', '/api/mobile/demo-login', mobile.demoLogin);
route('POST', '/api/mobile/register', mobile.register);
route('POST', '/api/mobile/logout', mobile.logout);
route('GET', '/api/mobile/me', mobile.me);
route('GET', '/api/mobile/home', mobile.home);
route('GET', '/api/mobile/competitions', mobile.competitions);
route('GET', '/api/mobile/competitions/:id', mobile.competition);
route('POST', '/api/mobile/competitions/:id/apply', mobile.apply);
route('GET', '/api/mobile/competitions/:id/teams', mobile.competitionTeams);
route('POST', '/api/mobile/competitions/:id/team', mobile.teamCreate);
route('POST', '/api/mobile/competitions/:id/team/join', mobile.teamJoin);
route('POST', '/api/mobile/competitions/:id/team/leave', mobile.teamLeave);
route('POST', '/api/mobile/competitions/:id/join', mobile.joinContestHandler);
route('GET', '/api/mobile/competitions/:id/schedule', mobile.schedule);
route('POST', '/api/mobile/registrations/:id/withdraw', mobile.withdraw);
route('POST', '/api/mobile/tasks/:id/submit', mobile.submit);
route('GET', '/api/mobile/schedule/upcoming', mobile.upcomingSchedule);
route('GET', '/api/mobile/rating', mobile.rating);
route('GET', '/api/mobile/rating/method', mobile.method);
route('GET', '/api/mobile/athletes/:id', mobile.athlete);
route('GET', '/api/mobile/calendar', mobile.calendar);
route('GET', '/api/mobile/news', mobile.news);
route('GET', '/api/mobile/news/:id', mobile.newsItem);
route('GET', '/api/mobile/documents', mobile.documents);
route('GET', '/api/mobile/about', mobile.about);
route('GET', '/api/mobile/cabinet', mobile.cabinet);
route('GET', '/api/mobile/notifications', mobile.notifications);
route('POST', '/api/mobile/notifications/read', mobile.readNotifications);
route('GET', '/api/mobile/profile', mobile.profile);
route('POST', '/api/mobile/profile', mobile.saveProfile);
route('POST', '/api/mobile/profile/rank', mobile.submitRank);
route('GET', '/api/mobile/chats', mobile.chats);
route('GET', '/api/mobile/chats/:id', mobile.chat);
route('GET', '/api/mobile/chats/:id/messages', mobile.chatMessages);
route('POST', '/api/mobile/chats/:id/messages', mobile.sendMessage);
route('GET', '/api/mobile/admin/overview', mobile.adminOverview);
route('GET', '/api/mobile/admin/competitions/:id/registrations', mobile.adminRegistrations);
route('POST', '/api/mobile/admin/registrations/:id/status', mobile.adminRegistrationStatus);
route('POST', '/api/mobile/admin/competitions/:id/transition', mobile.adminTransition);
route('POST', '/api/mobile/admin/competitions/:id/schedule', mobile.adminAddSchedule);
route('POST', '/api/mobile/admin/schedule/:id', mobile.adminUpdateSchedule);
route('POST', '/api/mobile/admin/schedule/:id/delete', mobile.adminDeleteSchedule);

export function matchRoute(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => {
      params[k] = decodeURIComponent(m[i + 1]);
    });
    return { handler: r.handler, params };
  }
  return null;
}
