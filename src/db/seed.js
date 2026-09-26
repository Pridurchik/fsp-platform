// Начальное наполнение базы.
// seedBase: справочники и параметры рейтинга. С ними платформа готова к работе с первого запуска.
// seedSample: пример наполнения для проверки и обучения (npm run sample). Спортсмены, организации
// и результаты в нём вымышлены, даты считаются от сегодняшнего дня.
import { all, get, run, tx } from './index.js';
import { hashPassword } from '../core/auth.js';
import { todayISO, addDays, addMonths, parts } from '../core/dates.js';
import { DEFAULT_CONFIG } from '../modules/rating/engine.js';
import { ratingDiff } from '../modules/rating/service.js';
import { fmt1, signed } from '../core/format.js';
import { localStamp } from '../modules/schedule.js';

const DISCIPLINES = [
  ['ALGO', 'Программирование алгоритмическое', 'Алгоритмическое'],
  ['PRODUCT', 'Программирование продуктовое', 'Продуктовое'],
  ['SECURITY', 'Программирование систем информационной безопасности', 'ИБ'],
  ['UAV', 'Программирование беспилотных авиационных систем', 'БАС'],
  ['ROBOTICS', 'Программирование робототехники', 'Робототехника'],
];

const LEVELS = [
  ['RUS', 'Чемпионат или Кубок России', 'ЧР / КР', 1000],
  ['ALLRUS', 'Другие всероссийские соревнования', 'Всероссийские', 600],
  ['INTERREG', 'Межрегиональные соревнования', 'Межрегиональные', 400],
  ['RD', 'Чемпионат или Кубок Республики Дагестан', 'ЧРД / КРД', 300],
  ['REGIONAL', 'Другие региональные соревнования', 'Региональные', 150],
  ['MUNICIPAL', 'Муниципальные и школьные соревнования', 'Муниципальные', 60],
];

const RANKS = [
  ['Y3', 'Третий юношеский спортивный разряд', 'III юн.', 'YOUTH', 10],
  ['Y2', 'Второй юношеский спортивный разряд', 'II юн.', 'YOUTH', 15],
  ['Y1', 'Первый юношеский спортивный разряд', 'I юн.', 'YOUTH', 20],
  ['R3', 'Третий спортивный разряд', 'III', 'RANK', 30],
  ['R2', 'Второй спортивный разряд', 'II', 'RANK', 50],
  ['R1', 'Первый спортивный разряд', 'I', 'RANK', 80],
  ['KMS', 'Кандидат в мастера спорта', 'КМС', 'RANK', 160],
  ['MS', 'Мастер спорта России', 'МС', 'TITLE', 300],
  ['MSMK', 'Мастер спорта России международного класса', 'МСМК', 'TITLE', 450],
];

// Городские округа и районы Республики Дагестан.
const CITIES = ['Махачкала', 'Буйнакск', 'Дагестанские Огни', 'Дербент', 'Избербаш', 'Каспийск', 'Кизилюрт', 'Кизляр', 'Хасавюрт', 'Южно-Сухокумск'];
const DISTRICTS = [
  'Агульский', 'Акушинский', 'Ахвахский', 'Ахтынский', 'Бабаюртовский', 'Ботлихский', 'Буйнакский', 'Гергебильский', 'Гумбетовский',
  'Гунибский', 'Дахадаевский', 'Дербентский', 'Докузпаринский', 'Казбековский', 'Кайтагский', 'Карабудахкентский', 'Каякентский',
  'Кизилюртовский', 'Кизлярский', 'Кулинский', 'Кумторкалинский', 'Курахский', 'Лакский', 'Левашинский', 'Магарамкентский',
  'Новолакский', 'Ногайский', 'Рутульский', 'Сергокалинский', 'Сулейман-Стальский', 'Табасаранский', 'Тарумовский', 'Тляратинский',
  'Унцукульский', 'Хасавюртовский', 'Хивский', 'Хунзахский', 'Цумадинский', 'Цунтинский', 'Чародинский', 'Шамильский',
].map((name) => `${name} район`);

export function seedBase() {
  tx(() => {
    DISCIPLINES.forEach(([code, name, short], i) => {
      run('INSERT INTO disciplines (code, name, short_name, sort_order) VALUES (?, ?, ?, ?)', code, name, short, i + 1);
    });
    LEVELS.forEach(([code, name, short, points], i) => {
      run('INSERT INTO competition_levels (code, name, short_name, base_points, sort_order) VALUES (?, ?, ?, ?, ?)', code, name, short, points, i + 1);
    });
    RANKS.forEach(([code, name, short, kind, bonus], i) => {
      run('INSERT INTO ranks (code, name, short_name, kind, bonus_points, sort_order) VALUES (?, ?, ?, ?, ?, ?)', code, name, short, kind, bonus, i + 1);
    });
    for (const name of CITIES) run("INSERT INTO municipalities (name, kind) VALUES (?, 'CITY')", name);
    for (const name of DISTRICTS) run("INSERT INTO municipalities (name, kind) VALUES (?, 'DISTRICT')", name);
    const c = DEFAULT_CONFIG;
    run(
      `INSERT INTO rating_config (id, version, top_n, window_months, full_months, place_floor, place_power, field_ref, field_min)
       VALUES (1, '1.0', ?, ?, ?, ?, ?, ?, ?)`,
      c.topN, c.windowMonths, c.fullMonths, c.placeFloor, c.placePower, c.fieldRef, c.fieldMin,
    );
    run(
      'INSERT INTO documents (title, category, url, description, published_at) VALUES (?, ?, ?, ?, ?)',
      'Методика рейтинга спортсменов ФСП РД', 'REGULATIONS', '/rating/method', 'Формула, веса и примеры расчёта. Действующая версия всегда на сайте.', todayISO(),
    );
  });
}

// ---------- пример наполнения ----------

const ORGANIZATIONS = [
  ['Технический университет', 'UNIVERSITY', 'Махачкала'],
  ['Государственный университет', 'UNIVERSITY', 'Махачкала'],
  ['Педагогический университет', 'UNIVERSITY', 'Махачкала'],
  ['Колледж информационных технологий', 'COLLEGE', 'Махачкала'],
  ['Физико-математический лицей', 'SCHOOL', 'Махачкала'],
  ['Лицей № 7', 'SCHOOL', 'Махачкала'],
  ['Гимназия № 2', 'SCHOOL', 'Махачкала'],
  ['Школа № 11', 'SCHOOL', 'Махачкала'],
  ['Лицей № 3', 'SCHOOL', 'Каспийск'],
  ['Центр цифрового образования детей', 'CLUB', 'Каспийск'],
  ['Гимназия № 1', 'SCHOOL', 'Дербент'],
  ['Колледж связи', 'COLLEGE', 'Дербент'],
  ['Лицей № 1', 'SCHOOL', 'Хасавюрт'],
  ['Школа № 2', 'SCHOOL', 'Буйнакск'],
  ['Школа № 4', 'SCHOOL', 'Избербаш'],
  ['Центр детского технического творчества', 'CLUB', 'Кизляр'],
  ['Школа № 1', 'SCHOOL', 'Кизилюрт'],
  ['Школа № 5', 'SCHOOL', 'Дагестанские Огни'],
  ['Карабудахкентская школа № 1', 'SCHOOL', 'Карабудахкентский район'],
  ['Левашинская школа', 'SCHOOL', 'Левашинский район'],
];

const MALE = ['Магомед', 'Шамиль', 'Рамазан', 'Ахмед', 'Руслан', 'Арсен', 'Камиль', 'Мурад', 'Тимур', 'Ислам', 'Гаджи', 'Саид', 'Али', 'Расул', 'Эльдар', 'Артём', 'Дмитрий', 'Никита', 'Абдулла', 'Заур', 'Салман', 'Рустам'];
const FEMALE = ['Патимат', 'Мадина', 'Аминат', 'Хадижат', 'Заира', 'Диана', 'Алина', 'Марьям', 'Эльмира', 'София', 'Анна', 'Лейла', 'Зарема', 'Карина'];
const SURNAMES = ['Абакаров', 'Алиев', 'Ахмедов', 'Байрамов', 'Гаджиев', 'Джабраилов', 'Исаев', 'Исмаилов', 'Кадиев', 'Курбанов', 'Магомедов', 'Меджидов', 'Мирзоев', 'Мусаев', 'Омаров', 'Османов', 'Рамазанов', 'Сулейманов', 'Халилов', 'Шахбанов', 'Эфендиев', 'Юнусов', 'Агаев', 'Амиров', 'Бутаев', 'Ибрагимов', 'Касумов', 'Нуров', 'Султанов', 'Татаев', 'Умаров', 'Хасаев', 'Чупанов', 'Батыров', 'Даудов', 'Абдурахманов'];
const PATRONYMICS = [['Магомедович', 'Магомедовна'], ['Шамилевич', 'Шамилевна'], ['Рамазанович', 'Рамазановна'], ['Ахмедович', 'Ахмедовна'], ['Русланович', 'Руслановна'], ['Арсенович', 'Арсеновна'], ['Камилевич', 'Камилевна'], ['Мурадович', 'Мурадовна'], ['Тимурович', 'Тимуровна'], ['Исламович', 'Исламовна'], ['Гаджиевич', 'Гаджиевна'], ['Алиевич', 'Алиевна'], ['Саидович', 'Саидовна'], ['Расулович', 'Расуловна']];

// Детерминированный генератор: при каждом сбросе база получается одинаковой.
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SAMPLE_PASSWORD = 'example123';

// Требует seedBase: справочники берутся из базы.
export function seedSample() {
  const T = todayISO();
  const rand = prng(20260926);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
  // Дата ровно n полных месяцев назад (плюс несколько дней запаса)
  const monthsAgo = (n) => addDays(addMonths(T, -n), -3);
  const yearOf = (iso) => parts(iso).y;
  const at = (iso, time = '10:00:00') => `${iso} ${time}`;

  const idsBy = (sql) => Object.fromEntries(all(sql).map((r) => [r.k, r.id]));
  const disc = idsBy('SELECT code AS k, id FROM disciplines');
  const lvl = idsBy('SELECT code AS k, id FROM competition_levels');
  const rank = idsBy('SELECT code AS k, id FROM ranks');
  const mun = idsBy('SELECT name AS k, id FROM municipalities');

  tx(() => {
    const org = {};
    const orgMunicipality = {};
    for (const [name, kind, m] of ORGANIZATIONS) {
      org[name] = run('INSERT INTO organizations (name, kind, municipality_id) VALUES (?, ?, ?)', name, kind, mun[m]).id;
      orgMunicipality[name] = m;
    }

    // ---------- пользователи ----------
    const password = hashPassword(SAMPLE_PASSWORD);
    const user = (email, role) => run('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)', email, password, role).id;
    const organizerUser = user('organizer@example.com', 'ORGANIZER');
    const athleteUser = user('athlete@example.com', 'ATHLETE');
    const noviceUser = user('novice@example.com', 'ATHLETE');

    // ---------- спортсмены ----------
    const athletes = [];
    const usedNames = new Set();
    function addAthlete({ last, first, middle, age, orgName, discs, userId = null, skill, isPublic = 1 }) {
      const birth = addDays(addMonths(T, -(age * 12 + int(0, 11))), -int(0, 27));
      const id = run(
        `INSERT INTO athletes (user_id, last_name, first_name, middle_name, birth_date, municipality_id, organization_id, is_public)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        userId, last, first, middle, birth, mun[orgMunicipality[orgName]], org[orgName], isPublic,
      ).id;
      for (const code of discs) run('INSERT INTO athlete_disciplines (athlete_id, discipline_id) VALUES (?, ?)', id, disc[code]);
      usedNames.add(`${last} ${first}`);
      const a = { id, last, first, age, skill, discs: new Set(discs) };
      athletes.push(a);
      return a;
    }

    // Спортсмен А из эталонного примера плана: КМС, рейтинг 1443,9
    const hero = addAthlete({ last: 'Гасанов', first: 'Амир', middle: 'Шамилевич', age: 20, orgName: 'Технический университет', discs: ['ALGO'], userId: athleteUser, skill: 0.99 });
    // Мастер спорта без стартов за два года
    const veteran = addAthlete({ last: 'Керимов', first: 'Эльдар', middle: 'Рамазанович', age: 24, orgName: 'Государственный университет', discs: ['ALGO'], skill: 0.95 });
    // Школьница с заполненным профилем и без заявок: удобно показать подачу заявки
    const novice = addAthlete({ last: 'Юсупова', first: 'Сабина', middle: 'Арсеновна', age: 15, orgName: 'Лицей № 3', discs: ['ALGO'], userId: noviceUser, skill: 0.6 });

    const orgNames = ORGANIZATIONS.map((o) => o[0]);
    while (athletes.length < 60) {
      const female = rand() < 0.35;
      const surname = pick(SURNAMES);
      const last = female ? `${surname}а` : surname;
      const first = female ? pick(FEMALE) : pick(MALE);
      if (usedNames.has(`${last} ${first}`)) continue;
      const middle = pick(PATRONYMICS)[female ? 1 : 0];
      const age = int(12, 22);
      const universityAge = age >= 18;
      const candidates = orgNames.filter((n) => {
        const kind = ORGANIZATIONS.find((o) => o[0] === n)[1];
        return universityAge ? kind === 'UNIVERSITY' || kind === 'COLLEGE' : kind === 'SCHOOL' || kind === 'CLUB';
      });
      const discs = [];
      if (rand() < 0.85) discs.push('ALGO');
      if (rand() < 0.22) discs.push('PRODUCT');
      if (rand() < 0.2) discs.push('SECURITY');
      if (rand() < 0.14) discs.push('UAV');
      if (rand() < 0.08) discs.push('ROBOTICS');
      if (!discs.length) discs.push('ALGO');
      addAthlete({
        last, first, middle, age,
        orgName: pick(candidates),
        discs,
        skill: Math.min(0.94, 0.25 + rand() * 0.55 + (age - 12) * 0.012),
        isPublic: rand() < 0.95 ? 1 : 0,
      });
    }

    // ---------- разряды ----------
    const giveRank = (a, code, assigned, validUntil, order, status = 'CONFIRMED') =>
      run(
        `INSERT INTO athlete_ranks (athlete_id, rank_id, assigned_at, valid_until, order_number, status, created_at, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        a.id, rank[code], assigned, validUntil, order, status, at(assigned), status === 'PENDING' ? null : at(addDays(assigned, 5)),
      );
    giveRank(hero, 'R1', monthsAgo(30), monthsAgo(6), '№ 57-к');
    giveRank(hero, 'KMS', monthsAgo(14), addMonths(T, 22), '№ 112-к');
    giveRank(veteran, 'MS', monthsAgo(36), null, '№ 45-нг');
    giveRank(novice, 'Y2', monthsAgo(7), addMonths(T, 17), '№ 31-юн');
    run(
      `INSERT INTO athlete_ranks (athlete_id, rank_id, assigned_at, valid_until, order_number, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
      novice.id, rank.R3, addDays(T, -12), addMonths(T, 24), '№ 204-р', at(addDays(T, -2), '18:20:00'),
    );
    const others = athletes.filter((a) => a !== hero && a !== veteran && a !== novice).sort((x, y) => y.skill - x.skill);
    others.forEach((a, i) => {
      const assigned = monthsAgo(int(2, 16));
      const valid = addMonths(assigned, 24);
      if (i < 2) giveRank(a, 'R1', assigned, valid, `№ ${int(60, 190)}-р`);
      else if (i < 9) giveRank(a, 'R2', assigned, valid, `№ ${int(60, 190)}-р`);
      else if (i < 18) giveRank(a, 'R3', assigned, valid, `№ ${int(60, 190)}-р`);
      else if (i < 30 && a.age < 17) giveRank(a, pick(['Y1', 'Y2', 'Y3']), assigned, valid, `№ ${int(20, 90)}-юн`);
    });
    // Две заявки на подтверждение и одна отклонённая — для очереди организатора
    giveRank(others[0], 'KMS', addDays(T, -20), addMonths(T, 36), '№ 219-к', 'PENDING');
    giveRank(others[12], 'R1', monthsAgo(4), addMonths(T, 20), '№ 999', 'REJECTED');

    // ---------- соревнования ----------
    function competition({ title, level, status, start, end, regStart = null, regEnd = null, format = 'OFFLINE', city = 'Махачкала', venue = null, external = 0, description, regulations = null }) {
      return run(
        `INSERT INTO competitions (title, level_id, format, city, venue, description, status, start_date, end_date, reg_start, reg_end,
                                   regulations_url, is_external, results_published_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        title, lvl[level], format, format === 'ONLINE' ? null : city, venue, description, status, start, end, regStart, regEnd,
        regulations, external, status === 'RESULTS_PUBLISHED' ? at(addDays(end, 2), '12:00:00') : null, at(addDays(start, -30)),
      ).id;
    }
    const event = (competitionId, code, total = null) =>
      run('INSERT INTO competition_events (competition_id, discipline_id, participants_total) VALUES (?, ?, ?)', competitionId, disc[code], total).id;

    // Поле участников: предпочитаем спортсменов этой дисциплины, порядок — сила плюс случайность дня.
    function field(code, n, exclude = []) {
      const skip = new Set(exclude.map((a) => a.id));
      const pool = athletes.filter((a) => !skip.has(a.id));
      const preferred = pool.filter((a) => a.discs.has(code));
      const rest = pool.filter((a) => !a.discs.has(code));
      const chosen = [...preferred.sort(() => rand() - 0.5), ...rest.sort(() => rand() - 0.5)].slice(0, n);
      return chosen
        .map((a) => ({ a, perf: a.skill + (rand() - 0.5) * 0.35 }))
        .sort((x, y) => y.perf - x.perf)
        .map((x) => x.a);
    }
    const placeAt = (list, athlete, place) => {
      const out = list.filter((a) => a.id !== athlete.id);
      out.splice(place - 1, 0, athlete);
      return out;
    };
    function results(eventId, ordered, { register = true, regDate }) {
      const n = ordered.length;
      ordered.forEach((a, i) => {
        const score = Math.round((n - i) * 40 + rand() * 25);
        run('INSERT INTO results (event_id, athlete_id, place, score) VALUES (?, ?, ?, ?)', eventId, a.id, i + 1, score);
        if (register) run("INSERT INTO registrations (event_id, athlete_id, status, created_at) VALUES (?, ?, 'APPROVED', ?)", eventId, a.id, at(regDate));
      });
    }
    const externalResults = (eventId, list) => {
      for (const [a, place] of list) run('INSERT INTO results (event_id, athlete_id, place) VALUES (?, ?, ?)', eventId, a.id, place);
    };
    const strongest = (exclude, n) => others.filter((a) => !exclude.includes(a)).slice(0, n);

    // 1. Чемпионат России — внешний старт: вносим только своих, участников по протоколу 120
    let end = monthsAgo(8);
    let id = competition({
      title: `Чемпионат России по спортивному программированию, алгоритмическое, ${yearOf(end)}`,
      level: 'RUS', status: 'RESULTS_PUBLISHED', start: addDays(end, -2), end, city: 'Москва', external: 1,
      description: 'Финал Чемпионата России. В базу внесены результаты спортсменов сборной Дагестана, число участников взято из итогового протокола.',
    });
    let ev = event(id, 'ALGO', 120);
    const [s1, s2, s3] = strongest([], 3);
    externalResults(ev, [[hero, 18], [s1, 45], [s2, 97]]);

    // 2. Чемпионат РД этого сезона: 34 участника, А победил
    end = monthsAgo(3);
    id = competition({
      title: `Чемпионат Республики Дагестан по алгоритмическому программированию ${yearOf(end)}`,
      level: 'RD', status: 'RESULTS_PUBLISHED', start: addDays(end, -1), end, venue: 'Технопарк, аудитория 204',
      description: 'Главный старт сезона по алгоритмическому программированию. Индивидуальный зачёт, пять часов, задачи в формате ICPC.',
      regulations: '/documents',
    });
    ev = event(id, 'ALGO');
    results(ev, placeAt(field('ALGO', 33, [hero, veteran, novice]), hero, 1), { regDate: addDays(end, -12) });

    // 3. Межрегиональные соревнования СКФО: внешний старт, 60 участников
    end = monthsAgo(15);
    id = competition({
      title: `Межрегиональные соревнования СКФО по алгоритмическому программированию ${yearOf(end)}`,
      level: 'INTERREG', status: 'RESULTS_PUBLISHED', start: addDays(end, -1), end, city: 'Пятигорск', external: 1,
      description: 'Соревнования команд и спортсменов регионов Северо-Кавказского федерального округа. Внесены результаты спортсменов Дагестана.',
    });
    ev = event(id, 'ALGO', 60);
    externalResults(ev, [[hero, 4], [s1, 12], [s3, 25], [others[5], 40]]);

    // 4. Открытое первенство Махачкалы: 12 участников, А второй
    end = monthsAgo(2);
    const cityCup = competition({
      title: `Открытое первенство Махачкалы по программированию ${yearOf(end)}`,
      level: 'REGIONAL', status: 'RESULTS_PUBLISHED', start: end, end, venue: 'Центр цифрового образования',
      description: 'Открытый турнир для школьников и студентов. Три часа, восемь задач.',
    });
    ev = event(cityCup, 'ALGO');
    results(ev, placeAt(field('ALGO', 11, [hero, veteran, novice]), hero, 2), { regDate: addDays(end, -10) });

    // 5. Чемпионат РД два года назад: результат старше 24 месяцев в рейтинг уже не идёт
    end = monthsAgo(27);
    id = competition({
      title: `Чемпионат Республики Дагестан по алгоритмическому программированию ${yearOf(end)}`,
      level: 'RD', status: 'RESULTS_PUBLISHED', start: addDays(end, -1), end,
      description: 'Чемпионат прошлого цикла. Результаты старше 24 месяцев остаются в истории, но в рейтинг не входят.',
    });
    ev = event(id, 'ALGO');
    let list = field('ALGO', 28, [hero, veteran, novice]);
    list = placeAt(placeAt(list, veteran, 1), hero, 2);
    results(ev, list, { regDate: addDays(end, -12) });

    // 6. Кубок РД по продуктовому программированию
    end = monthsAgo(5);
    id = competition({
      title: `Кубок Республики Дагестан по продуктовому программированию ${yearOf(end)}`,
      level: 'RD', status: 'RESULTS_PUBLISHED', start: addDays(end, -1), end, format: 'MIXED', venue: 'Технопарк',
      description: 'Двое суток на прототип продукта по кейсу от партнёров Федерации. Отбор дистанционный, финал очный.',
    });
    ev = event(id, 'PRODUCT');
    results(ev, field('PRODUCT', 16, [hero, veteran, novice]), { regDate: addDays(end, -14) });

    // 7. Первенство Каспийска: школьный уровень, Сабина третья
    end = monthsAgo(6);
    id = competition({
      title: `Первенство Каспийска по программированию среди школьников ${yearOf(end)}`,
      level: 'MUNICIPAL', status: 'RESULTS_PUBLISHED', start: end, end, city: 'Каспийск', venue: 'Лицей № 3',
      description: 'Городское первенство для учеников 7–11 классов.',
    });
    ev = event(id, 'ALGO');
    const youngsters = athletes.filter((a) => a.age <= 17 && a !== novice);
    let ordered = youngsters.map((a) => ({ a, perf: a.skill + (rand() - 0.5) * 0.3 })).sort((x, y) => y.perf - x.perf).map((x) => x.a).slice(0, 19);
    results(ev, placeAt(ordered, novice, 3), { regDate: addDays(end, -7) });

    // 8. Всероссийские соревнования по ИБ: внешний старт онлайн, 80 участников
    end = monthsAgo(10);
    id = competition({
      title: `Всероссийские соревнования по информационной безопасности (CTF) ${yearOf(end)}`,
      level: 'ALLRUS', status: 'RESULTS_PUBLISHED', start: addDays(end, -1), end, format: 'ONLINE', external: 1,
      description: 'Командно-личный CTF в формате Jeopardy. Внесены результаты спортсменов Дагестана.',
    });
    ev = event(id, 'SECURITY', 80);
    const ctf = field('SECURITY', 3, [hero, veteran, novice]);
    externalResults(ev, [[ctf[0], 14], [ctf[1], 33], [ctf[2], 61]]);

    // 9. Республиканский фестиваль: одно соревнование, четыре дисциплины
    end = monthsAgo(4);
    id = competition({
      title: `Республиканский фестиваль спортивного программирования ${yearOf(end)}`,
      level: 'REGIONAL', status: 'RESULTS_PUBLISHED', start: addDays(end, -1), end, venue: 'Технопарк',
      description: 'Фестиваль по четырём дисциплинам: алгоритмическое и продуктовое программирование, информационная безопасность, беспилотные авиационные системы.',
    });
    for (const [code, n] of [['ALGO', 15], ['PRODUCT', 9], ['SECURITY', 10], ['UAV', 8]]) {
      results(event(id, code), field(code, n, [hero, veteran, novice]), { regDate: addDays(end, -10) });
    }

    // 10. Идёт сейчас: школьная лига онлайн
    id = competition({
      title: 'Школьная лига программирования, осенний тур',
      level: 'MUNICIPAL', status: 'ONGOING', start: addDays(T, -2), end: addDays(T, 5), format: 'ONLINE',
      regStart: addDays(T, -20), regEnd: addDays(T, -3),
      description: 'Неделя на восемь задач в тестирующей системе. Для учеников 5–11 классов.',
    });
    ev = event(id, 'ALGO');
    for (const a of youngsters.slice(0, 14)) {
      run("INSERT INTO registrations (event_id, athlete_id, status, created_at) VALUES (?, ?, 'APPROVED', ?)", ev, a.id, at(addDays(T, -10)));
    }

    // 11. Кубок РД, осенний этап: регистрация открыта, 19 заявок, баллы из тестирующей системы уже подтянуты
    id = competition({
      title: 'Кубок Республики Дагестан по алгоритмическому программированию, осенний этап',
      level: 'RD', status: 'PUBLISHED', start: addDays(T, 7), end: addDays(T, 7), regStart: addDays(T, -10), regEnd: addDays(T, 5),
      venue: 'Технопарк, аудитория 204',
      description:
        'Первый этап Кубка Республики Дагестан сезона. Индивидуальный зачёт, пять часов, задачи в формате ICPC.\n\nК участию допускаются школьники и студенты образовательных организаций Дагестана. Итоги этапа идут в рейтинг ФСП РД.',
      regulations: '/documents',
    });
    ev = event(id, 'ALGO');
    const cupField = field('ALGO', 19, [hero, veteran, novice]);
    cupField.forEach((a, i) => {
      run('INSERT INTO registrations (event_id, athlete_id, status, created_at) VALUES (?, ?, ?, ?)', ev, a.id, i < 15 ? 'APPROVED' : 'SUBMITTED', at(addDays(T, -int(1, 9))));
      run('INSERT INTO results (event_id, athlete_id, score) VALUES (?, ?, ?)', ev, a.id, Math.round((19 - i) * 45 + rand() * 30));
    });

    // 12. Межрегиональный турнир по БАС: регистрация открыта
    id = competition({
      title: 'Межрегиональный турнир по программированию беспилотных авиационных систем',
      level: 'INTERREG', status: 'PUBLISHED', start: addDays(T, 25), end: addDays(T, 26), city: 'Каспийск', venue: 'Спорткомплекс, малый зал',
      regStart: addDays(T, -5), regEnd: addDays(T, 20),
      description: 'Автономный полёт по трассе с препятствиями. Участник пишет программу миссии для квадрокоптера.',
    });
    ev = event(id, 'UAV');
    for (const a of field('UAV', 6, [hero, veteran, novice])) {
      run("INSERT INTO registrations (event_id, athlete_id, status, created_at) VALUES (?, ?, 'SUBMITTED', ?)", ev, a.id, at(addDays(T, -int(0, 4))));
    }

    // 13. Первенство РД среди школьников: регистрация откроется позже
    id = competition({
      title: 'Первенство Республики Дагестан среди школьников по алгоритмическому программированию',
      level: 'RD', status: 'PUBLISHED', start: addDays(T, 40), end: addDays(T, 40), regStart: addDays(T, 10), regEnd: addDays(T, 35),
      venue: 'Физико-математический лицей',
      description: 'Для учеников 7–11 классов. Отбор на Первенство СКФО.',
    });
    event(id, 'ALGO');

    // 14. Черновик: виден только организатору
    id = competition({
      title: 'Открытый турнир по программированию робототехники',
      level: 'REGIONAL', status: 'DRAFT', start: addDays(T, 60), end: addDays(T, 61), regStart: addDays(T, 20), regEnd: addDays(T, 55),
      description: 'Черновик. Положение согласуется.',
    });
    event(id, 'ROBOTICS');

    // 15. Отменённое соревнование
    id = competition({
      title: 'Весенний кубок по информационной безопасности',
      level: 'REGIONAL', status: 'CANCELLED', start: monthsAgo(1), end: monthsAgo(1), format: 'ONLINE',
      description: 'Турнир отменён из-за переноса площадки. Новые даты объявим в новостях.',
    });
    event(id, 'SECURITY');

    // Изменения рейтинга после последнего опубликованного старта — для кабинета и уведомлений
    const cityEnd = monthsAgo(2);
    for (const d of ratingDiff(cityCup, { alreadyPublished: true })) {
      run(
        `INSERT INTO rating_changes (athlete_id, competition_id, rating_before, rating_after, position_before, position_after, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        d.athleteId, cityCup, d.before, d.after, d.positionBefore, d.positionAfter, at(addDays(cityEnd, 2), '12:00:00'),
      );
      if (d.athleteId === hero.id) {
        run(
          'INSERT INTO notifications (user_id, title, body, link, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?)',
          athleteUser,
          `Итоги: Открытое первенство Махачкалы по программированию ${yearOf(cityEnd)}`,
          `${d.bestPlace}-е место из 12 (Алгоритмическое). Рейтинг ${fmt1(d.before)} → ${fmt1(d.after)} (${signed(d.after - d.before)})`,
          `/competitions/${cityCup}`,
          at(addDays(cityEnd, 2), '12:00:00'),
          at(addDays(cityEnd, 3), '09:00:00'),
        );
      }
    }
    run(
      'INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)',
      athleteUser,
      'Открыта регистрация на Кубок РД, осенний этап',
      `Заявки принимаются до ${parts(addDays(T, 5)).d}.${String(parts(addDays(T, 5)).m).padStart(2, '0')}.`,
      '/competitions',
      at(addDays(T, -10), '09:30:00'),
    );

    // ---------- новости ----------
    const news = (date, title, excerpt, body) =>
      run('INSERT INTO news (title, excerpt, body, published_at) VALUES (?, ?, ?, ?)', title, excerpt, body, date);
    news(
      monthsAgo(3),
      `Итоги Чемпионата Республики Дагестан по алгоритмическому программированию ${yearOf(monthsAgo(3))}`,
      'Победил Амир Гасанов, Технический университет. В финале было 34 участника из девяти муниципалитетов.',
      'Чемпионат прошёл в Технопарке. За пять часов участники решали двенадцать задач в формате ICPC.\n\nПобедил Амир Гасанов (Технический университет, КМС). Полная таблица и баллы, которые каждое место дало в рейтинг, есть в карточке соревнования.\n\nЛучшие спортсмены чемпионата вошли в состав сборной республики на межрегиональные соревнования.',
    );
    news(
      addDays(T, -10),
      'Открыта регистрация на Кубок Республики Дагестан, осенний этап',
      'Заявки принимаются на платформе до конца регистрации. Старт через неделю, в Технопарке.',
      'Этап пройдёт в индивидуальном зачёте, пять часов, задачи в формате ICPC. Подать заявку можно в карточке соревнования после входа в личный кабинет.\n\nИтоги этапа сразу попадут в рейтинг ФСП РД: баллы зависят от уровня соревнования, занятого места и числа участников.',
    );
    news(
      addDays(T, -1),
      'Федерация запускает цифровую платформу',
      'Заявки, итоговые протоколы и рейтинг спортсменов теперь ведутся на сайте Федерации.',
      'Раньше сведения о спортсменах и результатах хранились в таблицах, документах и чатах. Теперь спортсмен подаёт заявку в два клика, а организатор вносит результаты там же, где видит участников.\n\nРейтинг считается по открытой методике. В профиле каждого спортсмена видно, за какой старт и сколько баллов начислено.',
    );

    // ---------- документы ----------
    const doc = (category, title, url, description) =>
      run('INSERT INTO documents (title, category, url, description, published_at) VALUES (?, ?, ?, ?, ?)', title, category, url, description, addDays(T, -int(5, 90)));
    doc('FEDERATION', 'Устав Федерации спортивного программирования Республики Дагестан', null, 'Действующая редакция.');
    doc('FEDERATION', 'Состав президиума и контакты Федерации', null, 'Руководство Федерации и контакты для спортсменов и тренеров.');
    doc('REGULATIONS', 'Положение о Кубке Республики Дагестан, осенний этап', null, 'Сроки, порядок допуска и подведения итогов.');
    doc('RULES', 'Правила вида спорта «спортивное программирование»', null, 'Правила, утверждённые Минспортом России.');
    doc('RULES', 'Дисциплины вида спорта «спортивное программирование»', 'https://habr.com/ru/news/715338/', 'Пять дисциплин, признанных Минспортом России: обзор.');
    doc('MATERIALS', 'Как готовиться к соревнованиям по алгоритмическому программированию', null, 'Памятка для школьников и тренеров.');
    doc('MATERIALS', 'API результатов Codeforces', 'https://codeforces.com/apiHelp/methods', 'Метод contest.standings пригодится для импорта протоколов.');

    // ---------- модуль проведения соревнований (кейс №2) ----------
    // Тестовый контест идёт прямо сейчас: три задания, участники, проверенные и ждущие проверки решения.
    // Новичок заявлен, но решений ещё не отправлял: на нём удобно показать отправку решения.
    const hh = (h) => `${String(h).padStart(2, '0')}:00`;
    const startHour = Math.max(0, new Date().getHours() - 1);
    const contestStart = new Date(`${T}T${hh(startHour)}:00`);
    const utcAfter = (minutes) => new Date(contestStart.getTime() + minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    const contestId = competition({
      title: 'Тестовый контест по алгоритмическому программированию',
      level: 'REGIONAL', status: 'ONGOING', start: T, end: T, format: 'ONLINE', regStart: addDays(T, -7), regEnd: addDays(T, -1),
      description: 'Онлайн-контест на платформе Федерации. Задания, отправка решений и таблица результатов находятся на этой странице.',
    });
    const contestEvent = event(contestId, 'ALGO');
    run(
      'INSERT INTO contests (competition_id, on_platform, start_time, end_time, rules, auto_status) VALUES (?, 1, ?, ?, ?, 0)',
      contestId, hh(startHour), startHour + 5 > 23 ? '23:59' : hh(startHour + 5),
      'Решение отправляется текстом или ссылкой на код. По каждому заданию можно отправить несколько попыток, в зачёт идёт лучшая оценка.\n\nРешения проверяет жюри вручную. При равной сумме баллов выше тот, кто раньше отправил последнее решение, принёсшее баллы.',
    );
    const task = (position, title, statement) =>
      run('INSERT INTO contest_tasks (competition_id, position, title, statement, max_score) VALUES (?, ?, ?, ?, 100)', contestId, position, title, statement).id;
    const tA = task(1, 'Сумма на отрезке', 'Дан массив из n целых чисел и q запросов. Каждый запрос задаёт отрезок [l, r], нужно вывести сумму элементов на нём.\n\nОграничения: n, q ≤ 200 000, |aᵢ| ≤ 10⁹. Опишите идею решения, оцените сложность и приложите ссылку на код.');
    const tB = task(2, 'Маршрут по городу', 'Карта города задана графом из n перекрёстков и m дорог одинаковой длины. Найдите наименьшее число дорог на пути от перекрёстка s до перекрёстка t или сообщите, что пути нет.\n\nОграничения: n, m ≤ 100 000. Опишите алгоритм и приложите код.');
    const tC = task(3, 'Расписание кружков', 'В центре цифрового образования n занятий, у каждого известно время начала и окончания. Выберите наибольшее число занятий, которые не пересекаются по времени, и объясните, почему выбор оптимален.\n\nОграничения: n ≤ 100 000.');
    const answers = {
      [tA]: ['Префиксные суммы: pref[i] = a₁ + … + aᵢ, ответ на запрос pref[r] − pref[l − 1]. Сложность O(n + q), суммы храню в 64-битных числах.', 'https://example.com/solutions/prefix-sums.cpp'],
      [tB]: ['Поиск в ширину от вершины s, расстояние до t — число рёбер. Если t не достигнута, ответ −1. Сложность O(n + m).', 'https://example.com/solutions/bfs.py'],
      [tC]: ['Жадный алгоритм: сортирую занятия по времени окончания и беру каждое, которое начинается не раньше конца предыдущего выбранного. Сложность O(n log n).', null],
    };
    const players = [hero, ...others.slice(1, 6)];
    for (const a of [...players, novice]) {
      run("INSERT INTO registrations (event_id, athlete_id, status, created_at) VALUES (?, ?, 'APPROVED', ?)", contestEvent, a.id, at(addDays(T, -3)));
    }
    const submit = (a, taskId, minute, score, comment = null) => run(
      `INSERT INTO submissions (task_id, athlete_id, answer_text, answer_url, created_at, score, comment, checked_at, checked_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      taskId, a.id, answers[taskId][0], answers[taskId][1], utcAfter(minute), score, comment,
      score === null ? null : utcAfter(minute + 5), score === null ? null : organizerUser,
    );
    const [p1, p2, p3, p4, p5] = players.slice(1);
    submit(hero, tA, 12, 100, 'Верно, оптимальная сложность.');
    submit(hero, tB, 31, 100);
    submit(hero, tC, 40, 40, 'Нет доказательства оптимальности.');
    submit(hero, tC, 50, 80, 'Доказательство есть, но без оценки сложности сортировки.');
    submit(p1, tA, 15, 100);
    submit(p1, tB, 38, 90, 'Не разобран случай, когда s = t.');
    submit(p1, tC, 57, null);
    submit(p2, tA, 18, 100);
    submit(p2, tB, 44, 70, 'Идея верная, код не проходит по времени на больших графах.');
    submit(p3, tA, 20, 100);
    submit(p3, tC, 52, 70);
    submit(p4, tA, 25, 60, 'Решение за O(n·q): верно, но медленно.');
    submit(p4, tB, 58, null);
    submit(p5, tA, 59, null);
    run(
      'INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)',
      noviceUser, 'Контест начался: Тестовый контест по алгоритмическому программированию', 'Задания открыты, решения принимаются до окончания контеста.',
      `/competitions/${contestId}#tasks`, utcAfter(0),
    );

    // ---------- хакатоны: чат участников и расписание ----------
    // Идущий хакатон: Сабина допущена и в чате, часть расписания прошла, кофе-брейк начнётся через пару минут
    // после загрузки примера — уведомление придёт на телефон. Предстоящий хакатон с открытой регистрацией:
    // на нём удобно показать путь «заявка → одобрение организатором → чат».
    const utcAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ');
    const localIn = (minutes) => localStamp(new Date(Date.now() + minutes * 60_000));
    const localAt = (days, time) => `${addDays(T, days)}T${time}`;
    const nameOf = (a) => `${a.first} ${a.last}`;
    const chatFor = (competitionId) => run('INSERT INTO chats (competition_id, created_at) VALUES (?, ?)', competitionId, utcAgo(60 * 24 * 3)).id;
    const say = (chatId, userId, body, minutesAgo) =>
      run('INSERT INTO chat_messages (chat_id, user_id, body, created_at) VALUES (?, ?, ?, ?)', chatId, userId, body, utcAgo(minutesAgo)).id;
    const schedule = (competitionId, kind, title, startsAt, description = null, notified = false) =>
      run(
        'INSERT INTO schedule_items (competition_id, kind, title, description, starts_at, notified_at) VALUES (?, ?, ?, ?, ?, ?)',
        competitionId, kind, title, description, startsAt, notified ? utcAgo(1) : null,
      ).id;
    const productTeam = field('PRODUCT', 14, [hero, veteran, novice]);
    // Вымышленные аккаунты части участников: без аккаунта спортсмен не попадает в чат.
    novice.userId = noviceUser;
    [0, 1, 2, 3, 4, 9, 10].forEach((i, n) => {
      const a = productTeam[i];
      a.userId = user(`team${n + 1}@example.com`, 'ATHLETE');
      run('UPDATE athletes SET user_id = ? WHERE id = ?', a.userId, a.id);
    });
    const joinChat = (chatId, a, minutesAgo) => {
      if (!a.userId) return;
      run('INSERT INTO chat_members (chat_id, user_id, joined_at, last_read_id) VALUES (?, ?, ?, 0)', chatId, a.userId, utcAgo(minutesAgo));
      say(chatId, null, `Новый участник: ${nameOf(a)}`, minutesAgo);
    };

    const hackId = competition({
      title: 'Хакатон «Цифровой Дагестан»',
      level: 'REGIONAL', status: 'ONGOING', start: T, end: addDays(T, 1), regStart: addDays(T, -20), regEnd: addDays(T, -2),
      venue: 'Технопарк, коворкинг',
      description: 'Командный хакатон по продуктовому программированию: 30 часов на работающий прототип сервиса для жителей республики.\n\nКейсы от министерств и ИТ-компаний. Два чекпоинта с менторами, защита проектов перед жюри. Расписание и объявления организаторов приходят участникам в чат и уведомления.',
    });
    const hackEvent = event(hackId, 'PRODUCT');
    const hackers = [novice, ...productTeam.slice(0, 8)];
    for (const a of hackers) {
      run("INSERT INTO registrations (event_id, athlete_id, status, created_at) VALUES (?, ?, 'APPROVED', ?)", hackEvent, a.id, at(addDays(T, -6)));
    }
    run("INSERT INTO registrations (event_id, athlete_id, status, created_at) VALUES (?, ?, 'SUBMITTED', ?)", hackEvent, productTeam[8].id, at(addDays(T, -1), '21:40:00'));
    const hackChat = chatFor(hackId);
    hackers.forEach((a, i) => joinChat(hackChat, a, 60 * 24 * 5 - i * 7));
    run('INSERT INTO chat_members (chat_id, user_id, joined_at, last_read_id) VALUES (?, ?, ?, 0)', hackChat, organizerUser, utcAgo(60 * 24 * 5));
    say(hackChat, organizerUser, 'Добро пожаловать на хакатон «Цифровой Дагестан»! Здесь будут объявления, а пункты расписания придут уведомлениями. Вопросы по кейсам задавайте прямо в чат.', 60 * 24 * 4);
    const opening = localIn(-180);
    const checkpoint1 = localIn(-60);
    const startedAgo = (stamp) => Math.floor((Date.now() - new Date(`${stamp}:00`).getTime()) / 60_000);
    schedule(hackId, 'OPENING', 'Открытие хакатона', opening, 'Главный зал Технопарка. Представление кейсов и менторов.', true);
    say(hackChat, null, 'Начинается открытие: Открытие хакатона. Главный зал Технопарка. Представление кейсов и менторов.', startedAgo(opening));
    say(hackChat, noviceUser, 'Мы берём кейс про запись к врачу. Ищем дизайнера, если кто-то свободен, пишите!', startedAgo(opening) - 25);
    say(hackChat, productTeam[1].userId, 'Я дизайнер, могу присоединиться. Где вы сидите?', startedAgo(opening) - 31);
    say(hackChat, noviceUser, 'Стол 7, у окна 🙂', startedAgo(opening) - 33);
    say(hackChat, productTeam[3].userId, 'Подскажите, Wi-Fi в коворкинге с паролем?', startedAgo(opening) - 70);
    say(hackChat, organizerUser, 'Сеть «Technopark-Guest», пароль на стойке регистрации.', startedAgo(opening) - 74);
    schedule(hackId, 'CHECKPOINT', 'Идея и команда', checkpoint1, 'Менторы обходят команды: проблема, пользователь, план прототипа.', true);
    say(hackChat, null, 'Начинается чекпоинт: Идея и команда. Менторы обходят команды: проблема, пользователь, план прототипа.', startedAgo(checkpoint1));
    say(hackChat, productTeam[0].userId, 'Менторы, у кого можно спросить про API записи к врачу?', startedAgo(checkpoint1) - 20);
    say(hackChat, organizerUser, 'Через пару минут кофе-брейк на втором этаже. Потом продолжаем работу до обеда.', 4);
    schedule(hackId, 'COFFEE_BREAK', 'Кофе-брейк', localIn(2), 'Второй этаж, у переговорной.');
    schedule(hackId, 'MEAL', 'Обед', localIn(75), 'Столовая Технопарка, по бейджам.');
    schedule(hackId, 'CHECKPOINT', 'Работающий прототип', localIn(240), 'Покажите менторам сценарий от начала до конца.');
    schedule(hackId, 'WORKSHOP', 'Как защитить проект за 5 минут', localIn(300), 'Мастер-класс по питчу от жюри.');
    schedule(hackId, 'DEADLINE', 'Сдача проектов', localAt(1, '12:00'), 'Ссылка на репозиторий и презентацию в форме у организатора.');
    schedule(hackId, 'PITCH', 'Защита проектов', localAt(1, '13:00'), '5 минут на выступление и 3 минуты на вопросы жюри.');
    schedule(hackId, 'CLOSING', 'Закрытие и награждение', localAt(1, '17:00'));
    run(
      'INSERT INTO notifications (user_id, title, body, link, created_at, read_at) VALUES (?, ?, ?, ?, ?, ?)',
      noviceUser, 'Заявка одобрена: Хакатон «Цифровой Дагестан»',
      'Организатор допустил вас к участию и добавил в чат участников. Когда соревнование начнётся, сюда будут приходить чекпоинты, перерывы и другие пункты расписания.',
      `/competitions/${hackId}/chat`, utcAgo(60 * 24 * 5), utcAgo(60 * 24 * 5 - 30),
    );
    run(
      'INSERT INTO notifications (user_id, title, body, link, created_at) VALUES (?, ?, ?, ?, ?)',
      noviceUser, 'Начинается чекпоинт: Идея и команда', 'Хакатон «Цифровой Дагестан» · Менторы обходят команды: проблема, пользователь, план прототипа.',
      `/competitions/${hackId}#schedule-${get('SELECT MAX(id) AS id FROM schedule_items WHERE kind = ? AND competition_id = ?', 'CHECKPOINT', hackId).id}`, utcAgo(startedAgo(checkpoint1)),
    );

    const smartId = competition({
      title: 'Хакатон «Умный город»',
      level: 'REGIONAL', status: 'PUBLISHED', start: addDays(T, 14), end: addDays(T, 15), regStart: addDays(T, -5), regEnd: addDays(T, 10),
      venue: 'Дагестанский государственный технический университет',
      description: 'Двухдневный хакатон: сервисы для городского транспорта, ЖКХ и экологии Махачкалы.\n\nПосле одобрения заявки организатор добавит вас в чат участников. Во время хакатона в чат и уведомления приходят чекпоинты, кофе-брейки и защита проектов.',
    });
    const smartEvent = event(smartId, 'PRODUCT');
    const smartChat = chatFor(smartId);
    productTeam.slice(9, 12).forEach((a, i) => {
      run("INSERT INTO registrations (event_id, athlete_id, status, created_at) VALUES (?, ?, 'APPROVED', ?)", smartEvent, a.id, at(addDays(T, -4 + i)));
      joinChat(smartChat, a, 60 * 24 * (4 - i));
    });
    say(smartChat, organizerUser, 'Здравствуйте! Это чат участников «Умного города». За неделю до старта опубликуем кейсы и список менторов.', 60 * 24 * 2 - 30);
    for (const a of productTeam.slice(12, 14)) {
      run("INSERT INTO registrations (event_id, athlete_id, status, created_at) VALUES (?, ?, 'SUBMITTED', ?)", smartEvent, a.id, at(addDays(T, -1)));
    }
    schedule(smartId, 'OPENING', 'Открытие', localAt(14, '10:00'), 'Актовый зал, главный корпус.');
    schedule(smartId, 'CHECKPOINT', 'Проблема и решение', localAt(14, '15:00'));
    schedule(smartId, 'COFFEE_BREAK', 'Кофе-брейк', localAt(14, '17:00'));
    schedule(smartId, 'CHECKPOINT', 'Прототип', localAt(15, '10:00'));
    schedule(smartId, 'PITCH', 'Защита проектов', localAt(15, '14:00'));
    schedule(smartId, 'CLOSING', 'Награждение', localAt(15, '18:00'));

    // Пример наполнения загружен: на странице входа появятся кнопки быстрого входа.
    run("INSERT INTO settings (key, value) VALUES ('sample_data', '1') ON CONFLICT(key) DO UPDATE SET value = '1'");
  });
}
