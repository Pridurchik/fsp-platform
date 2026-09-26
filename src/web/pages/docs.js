// Документация API: JSON-спецификация и страница Swagger UI.
// Спецификация — в src/modules/openapi.js (без зависимостей).
// Swagger UI завендорен в public/vendor/swagger-ui (без npm-зависимостей),
// поэтому /api/docs работает офлайн. Сырой JSON: /api/openapi.json.
import { html } from '../../core/html.js';
import { layout } from '../layout.js';
import { openApiSpec } from '../../modules/openapi.js';

export function openapiJson(ctx) {
  ctx.json(openApiSpec());
}

export function docsPage(ctx) {
  ctx.html(
    layout(ctx, {
      title: 'API: документация',
      section: '',
      description: 'Swagger-документация открытого и мобильного API платформы ФСП РД.',
      body: html`<section class="wrap">
        <h1>Документация API</h1>
        <p class="muted">Спецификация OpenAPI: <a href="/api/openapi.json"><code>/api/openapi.json</code></a>.
        Мобильный API требует заголовок <code>Authorization: Bearer &lt;token&gt;</code> (токен из <code>POST /api/mobile/login</code>).
        Публичный <code>/api/v1</code> — без авторизации.</p>
        <link rel="stylesheet" href="/static/vendor/swagger-ui/swagger-ui.css">
        <div id="swagger-ui"><p class="muted">Загрузка Swagger UI… Если интерфейс не появился, откройте <a href="/api/openapi.json">сырой JSON</a>.</p></div>
        <script src="/static/vendor/swagger-ui/swagger-ui-bundle.js"></script>
        <script>
          window.addEventListener('DOMContentLoaded', function () {
            if (window.SwaggerUIBundle) {
              SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger-ui', deepLinking: true, persistAuthorization: true });
            }
          });
        </script>
      </section>`,
    }),
  );
}
