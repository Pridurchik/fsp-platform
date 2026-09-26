// OpenAPI-спецификация публичного и мобильного API.
// Источник правды по путям — src/routes.js, по форматам — src/web/pages/api.js и mobile.js.
// Без внешних зависимостей: чистый объект, отдаётся как JSON на /api/openapi.json.
export function openApiSpec() {
  const disciplines = ['ALGO', 'PRODUCT', 'SECURITY', 'UAV', 'ROBOTICS'];
  return {
    openapi: '3.0.3',
    info: {
      title: 'ФСП РД API',
      version: '1.0.0',
      description:
        'Открытый API платформы Федерации спортивного программирования РД. ' +
        '/api/v1 — только чтение без авторизации (сайт школы, Telegram-бот). ' +
        '/api/mobile/* — JSON для мобильного приложения, вход по токену `Authorization: Bearer <token>`. ' +
        'Интерактивная документация: /api/docs.',
    },
    servers: [{ url: '/', description: 'Текущий сервер (PUBLIC_URL в продакшене)' }],
    tags: [
      { name: 'v1', description: 'Публичный API только для чтения, без авторизации' },
      { name: 'mobile-auth', description: 'Вход, регистрация, профиль сессии' },
      { name: 'mobile-public', description: 'Соревнования, рейтинг, контент для приложения' },
      { name: 'mobile-athlete', description: 'Требуют роль спортсмена (Bearer)' },
      { name: 'mobile-user', description: 'Требуют вход (спортсмен или организатор)' },
      { name: 'mobile-admin', description: 'Только организатор (Bearer)' },
    ],
    security: [],
    paths: {
      '/api/docs': {
        get: {
          tags: ['v1'],
          summary: 'Интерактивная Swagger-документация (HTML)',
          responses: { 200: { description: 'HTML-страница со Swagger UI' } },
        },
      },
      '/api/openapi.json': {
        get: {
          tags: ['v1'],
          summary: 'OpenAPI-спецификация этого API (JSON)',
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/v1': {
        get: {
          tags: ['v1'],
          summary: 'Список разделов API v1',
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiIndex' } } } } },
        },
      },
      '/api/v1/competitions': {
        get: {
          tags: ['v1'],
          summary: 'Список соревнований',
          parameters: [
            { name: 'tab', in: 'query', schema: { type: 'string', enum: ['upcoming', 'current', 'finished'] }, description: 'Без параметра — все' },
          ],
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/CompetitionList' } } } } },
        },
      },
      '/api/v1/competitions/{id}': {
        get: {
          tags: ['v1'],
          summary: 'Карточка соревнования с итогами',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Competition' } } } },
            404: { description: 'Черновик или нет такого', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/api/v1/rating': {
        get: {
          tags: ['v1'],
          summary: 'Рейтинг (общий или по дисциплине)',
          parameters: [{ name: 'd', in: 'query', schema: { type: 'string', enum: disciplines }, description: 'Без параметра — общий зачёт' }],
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/RatingBoard' } } } } },
        },
      },
      '/api/v1/athletes/{id}': {
        get: {
          tags: ['v1'],
          summary: 'Публичный профиль и разбор рейтинга',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/AthleteBreakdown' } } } },
            404: { description: 'Профиль не найден или скрыт', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/api/mobile/config': {
        get: {
          tags: ['mobile-public'],
          summary: 'Настройки приложения: справочники, демо-аккаунты',
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/MobileConfig' } } } } },
        },
      },
      '/api/mobile/login': {
        post: {
          tags: ['mobile-auth'],
          summary: 'Вход по почте и паролю, возвращает Bearer-токен',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email', example: 'athlete@example.com' }, password: { type: 'string', example: 'example123' } } } } } },
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } } },
            400: { description: 'Неверная почта или пароль', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/api/mobile/demo-login': {
        post: {
          tags: ['mobile-auth'],
          summary: 'Быстрый вход в пример наполнения (только после npm run sample)',
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['as'], properties: { as: { type: 'string', enum: ['organizer', 'novice', 'athlete'] } } } } } },
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } } },
            400: { description: 'Пример наполнения не загружен', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/api/mobile/register': {
        post: {
          tags: ['mobile-auth'],
          summary: 'Регистрация спортсмена',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['lastName', 'firstName', 'email', 'password', 'consent'],
                  properties: {
                    lastName: { type: 'string', example: 'Юсупова' },
                    firstName: { type: 'string', example: 'Сабина' },
                    middleName: { type: 'string' },
                    email: { type: 'string', format: 'email' },
                    password: { type: 'string', minLength: 8 },
                    consent: { type: 'boolean', description: 'Согласие на обработку ПДн (за несовершеннолетних — от представителя)' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Создан', content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } } },
            400: { description: 'Ошибка валидации, поле fields подсказывает поле', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/api/mobile/logout': {
        post: {
          tags: ['mobile-auth'],
          summary: 'Выход (отзывает текущий токен)',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'OK', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } } },
        },
      },
      '/api/mobile/me': {
        get: {
          tags: ['mobile-auth'],
          summary: 'Текущий пользователь',
          security: [{ bearerAuth: [] }],
          responses: {
            200: { description: 'OK', content: { 'application/json': { schema: { $ref: '#/components/schemas/Me' } } } },
            401: { description: 'Нет/неверный токен', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/api/mobile/home': {
        get: {
          tags: ['mobile-public'],
          summary: 'Главная: featured-старт, ближайшие, новости, топ-5 рейтинга',
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/mobile/competitions': {
        get: {
          tags: ['mobile-public'],
          summary: 'Соревнования с фильтрами',
          parameters: [
            { name: 'tab', in: 'query', schema: { type: 'string', enum: ['upcoming', 'current', 'finished'], default: 'upcoming' } },
            { name: 'd', in: 'query', schema: { type: 'string', enum: disciplines } },
            { name: 'level', in: 'query', schema: { type: 'string', description: 'Код уровня, см. /api/mobile/config' } },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/mobile/competitions/{id}': {
        get: {
          tags: ['mobile-public'],
          summary: 'Карточка: заявка, чат, расписание, контест, результаты, участники',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: {
            200: { description: 'OK' },
            404: { description: 'Не найдено', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/api/mobile/competitions/{id}/apply': {
        post: {
          tags: ['mobile-athlete'],
          summary: 'Подать заявку на дисциплину (eventId)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', description: 'ID соревнования' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['eventId'], properties: { eventId: { type: 'integer' } } } } } },
          responses: { 200: { description: 'OK' }, 400: { description: 'Профиль неполный или заявка уже есть', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
      '/api/mobile/competitions/{id}/join': {
        post: {
          tags: ['mobile-athlete'],
          summary: 'Стать участником контеста на платформе',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'OK' }, 400: { description: 'Ошибка', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
      '/api/mobile/competitions/{id}/schedule': {
        get: {
          tags: ['mobile-public'],
          summary: 'Расписание соревнования + текущий/следующий пункт',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'OK' }, 404: { description: 'Не найдено', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
      '/api/mobile/registrations/{id}/withdraw': {
        post: {
          tags: ['mobile-athlete'],
          summary: 'Отозвать свою заявку',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', description: 'ID заявки' } }],
          responses: { 200: { description: 'OK' }, 400: { description: 'Ошибка', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
      '/api/mobile/tasks/{id}/submit': {
        post: {
          tags: ['mobile-athlete'],
          summary: 'Отправить решение на задание контеста',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', description: 'ID задания' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { text: { type: 'string' }, url: { type: 'string', format: 'uri' } } } } } },
          responses: { 200: { description: 'OK' }, 400: { description: 'Пустое решение или контест завершён', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
      '/api/mobile/schedule/upcoming': {
        get: {
          tags: ['mobile-user'],
          summary: 'Будущие пункты расписания пользователя (для напоминаний)',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'OK' }, 401: { description: 'Нужен вход', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
      '/api/mobile/rating': {
        get: {
          tags: ['mobile-public'],
          summary: 'Рейтинг с фильтром по муниципалитету и поиском',
          parameters: [
            { name: 'd', in: 'query', schema: { type: 'string', enum: disciplines } },
            { name: 'm', in: 'query', schema: { type: 'integer', description: 'ID муниципалитета' } },
            { name: 'q', in: 'query', schema: { type: 'string', description: 'Поиск по ФИО' } },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/mobile/rating/method': {
        get: { tags: ['mobile-public'], summary: 'Методика рейтинга: веса, уровни, примеры коэффициентов', responses: { 200: { description: 'OK' } } },
      },
      '/api/mobile/athletes/{id}': {
        get: {
          tags: ['mobile-public'],
          summary: 'Профиль спортсмена с разбором рейтинга',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'd', in: 'query', schema: { type: 'string', enum: disciplines } },
          ],
          responses: {
            200: { description: 'OK' },
            403: { description: 'Профиль скрыт', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
            404: { description: 'Не найдено', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/api/mobile/calendar': { get: { tags: ['mobile-public'], summary: 'Календарь сезона по месяцам', responses: { 200: { description: 'OK' } } } },
      '/api/mobile/news': { get: { tags: ['mobile-public'], summary: 'Новости', responses: { 200: { description: 'OK' } } } },
      '/api/mobile/news/{id}': {
        get: {
          tags: ['mobile-public'],
          summary: 'Новость целиком',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'OK' }, 404: { description: 'Не найдено', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
      '/api/mobile/documents': { get: { tags: ['mobile-public'], summary: 'Документы по группам', responses: { 200: { description: 'OK' } } } },
      '/api/mobile/about': { get: { tags: ['mobile-public'], summary: 'О федерации и контакты', responses: { 200: { description: 'OK' } } } },
      '/api/mobile/cabinet': {
        get: {
          tags: ['mobile-athlete'],
          summary: 'Кабинет спортсмена: рейтинг, заявки, уведомления',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'OK' }, 401: { description: 'Нужен вход', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
      '/api/mobile/notifications': {
        get: {
          tags: ['mobile-user'],
          summary: 'Уведомления (polling через after)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'after', in: 'query', schema: { type: 'integer', default: 0 }, description: 'Отдать только id > after' },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          ],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/mobile/notifications/read': {
        post: {
          tags: ['mobile-user'],
          summary: 'Пометить все уведомления прочитанными',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/mobile/profile': {
        get: {
          tags: ['mobile-athlete'],
          summary: 'Текущие значения профиля + справочники для формы',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'OK' } },
        },
        post: {
          tags: ['mobile-athlete'],
          summary: 'Сохранить профиль',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    lastName: { type: 'string' },
                    firstName: { type: 'string' },
                    middleName: { type: 'string' },
                    birthDate: { type: 'string', format: 'date', example: '2009-03-14' },
                    municipalityId: { type: 'integer' },
                    organizationId: { type: 'integer' },
                    disciplineIds: { type: 'array', items: { type: 'integer' } },
                    isPublic: { type: 'boolean', default: true },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'OK' }, 400: { description: 'Ошибка валидации', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
      '/api/mobile/chats': {
        get: {
          tags: ['mobile-user'],
          summary: 'Чаты соревнований пользователя',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'OK' } },
        },
      },
      '/api/mobile/chats/{id}': {
        get: {
          tags: ['mobile-user'],
          summary: 'Чат соревнования (последние 60 сообщений)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', description: 'ID соревнования (= чата)' } }],
          responses: {
            200: { description: 'OK' },
            403: { description: 'Нет допуска (заявка не одобрена)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/api/mobile/chats/{id}/messages': {
        get: {
          tags: ['mobile-user'],
          summary: 'Сообщения чата (пагинация через after/before)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
            { name: 'after', in: 'query', schema: { type: 'integer' } },
            { name: 'before', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { 200: { description: 'OK' } },
        },
        post: {
          tags: ['mobile-user'],
          summary: 'Отправить сообщение в чат',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['body'], properties: { body: { type: 'string', maxLength: 2000 } } } } } },
          responses: {
            201: { description: 'Создано' },
            400: { description: 'Пустое сообщение', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          },
        },
      },
      '/api/mobile/admin/overview': {
        get: {
          tags: ['mobile-admin'],
          summary: 'Панель организатора: заявки на рассмотрении',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'OK' }, 403: { description: 'Только организатор', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
      '/api/mobile/admin/competitions/{id}/registrations': {
        get: {
          tags: ['mobile-admin'],
          summary: 'Заявки соревнования для модерации',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'OK' }, 404: { description: 'Не найдено', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
      '/api/mobile/admin/registrations/{id}/status': {
        post: {
          tags: ['mobile-admin'],
          summary: 'Сменить статус заявки: APPROVED | REJECTED | SUBMITTED',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['APPROVED', 'REJECTED', 'SUBMITTED'] } } } } } },
          responses: { 200: { description: 'OK' }, 400: { description: 'Ошибка', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
      '/api/mobile/admin/competitions/{id}/schedule': {
        post: {
          tags: ['mobile-admin'],
          summary: 'Добавить пункт расписания',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ScheduleInput' } } } },
          responses: { 201: { description: 'Создано' }, 400: { description: 'Ошибка валидации', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
      '/api/mobile/admin/schedule/{id}': {
        post: {
          tags: ['mobile-admin'],
          summary: 'Изменить пункт расписания',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ScheduleInput' } } } },
          responses: { 200: { description: 'OK' }, 404: { description: 'Не найдено', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
      '/api/mobile/admin/schedule/{id}/delete': {
        post: {
          tags: ['mobile-admin'],
          summary: 'Удалить пункт расписания',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'OK' }, 404: { description: 'Не найдено', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', description: 'Токен из POST /api/mobile/login в заголовке Authorization: Bearer <token>' },
      },
      schemas: {
        Error: { type: 'object', required: ['error'], properties: { error: { type: 'string', example: 'Соревнование не найдено' }, code: { type: 'string' }, fields: { type: 'object' } } },
        ApiIndex: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'ФСП РД API' },
            version: { type: 'string', example: '1' },
            endpoints: { type: 'object' },
          },
        },
        CompetitionList: {
          type: 'object',
          properties: { count: { type: 'integer' }, items: { type: 'array', items: { $ref: '#/components/schemas/Competition' } } },
        },
        Competition: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            title: { type: 'string' },
            status: { type: 'string', enum: ['DRAFT', 'PUBLISHED', 'ONGOING', 'FINISHED', 'RESULTS_PUBLISHED', 'CANCELLED'] },
            statusLabel: { type: 'string' },
            level: { type: 'object', properties: { code: { type: 'string' }, name: { type: 'string' }, basePoints: { type: 'number' } } },
            format: { type: 'string', enum: ['OFFLINE', 'ONLINE', 'MIXED'] },
            city: { type: 'string', nullable: true },
            venue: { type: 'string', nullable: true },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            url: { type: 'string', example: '/competitions/1' },
          },
        },
        RatingBoard: {
          type: 'object',
          properties: {
            asOf: { type: 'string', format: 'date' },
            discipline: { type: 'string', example: 'ALL' },
            count: { type: 'integer' },
            items: { type: 'array', items: { type: 'object' } },
          },
        },
        AthleteBreakdown: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
            rating: { type: 'number' },
            position: { type: 'integer', nullable: true },
            of: { type: 'integer' },
            counted: { type: 'array', items: { type: 'object' } },
          },
        },
        MobileConfig: {
          type: 'object',
          properties: {
            name: { type: 'string', example: 'ФСП РД' },
            apiVersion: { type: 'integer', example: 1 },
            serverTime: { type: 'integer' },
            sample: { type: 'boolean' },
            demoAccounts: { type: 'array', items: { type: 'object' } },
            disciplines: { type: 'array', items: { type: 'object' } },
            levels: { type: 'array', items: { type: 'object' } },
          },
        },
        Session: {
          type: 'object',
          properties: { token: { type: 'string', description: 'Передавать как Authorization: Bearer <token>' }, me: { $ref: '#/components/schemas/Me' } },
        },
        Me: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            email: { type: 'string' },
            role: { type: 'string', enum: ['ATHLETE', 'ORGANIZER', 'ADMIN'] },
            isOrganizer: { type: 'boolean' },
            athlete: { type: 'object', nullable: true },
            unreadNotifications: { type: 'integer' },
            unreadChats: { type: 'integer' },
          },
        },
        ScheduleInput: {
          type: 'object',
          required: ['kind', 'title', 'date', 'time'],
          properties: {
            kind: { type: 'string', enum: ['OPENING', 'CHECKPOINT', 'COFFEE_BREAK', 'MEAL', 'WORKSHOP', 'DEADLINE', 'PITCH', 'CLOSING', 'OTHER'] },
            title: { type: 'string', maxLength: 200 },
            description: { type: 'string' },
            date: { type: 'string', format: 'date', example: '2026-10-01' },
            time: { type: 'string', example: '10:00' },
          },
        },
      },
    },
  };
}
