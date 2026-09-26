// Переключатель темы: меняет только цвета, выбор сохраняется в localStorage.
// Тема по умолчанию светлая, её же ставит inline-скрипт в <head> до отрисовки.
const THEME_KEY = 'fsp-theme';
const THEME_COLOR = { light: '#ffffff', dark: '#1b1c21' };

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLOR[theme];
  const label = theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
  document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  });
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('[data-theme-toggle]')) return;
  const theme = currentTheme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch (e) { /* без localStorage тема живёт только до перезагрузки */ }
  applyTheme(theme);
});

applyTheme(currentTheme());

// Небольшие улучшения поверх обычных форм: сайт работает и без JavaScript.
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  const question = form.getAttribute('data-confirm');
  if (question && !window.confirm(question)) {
    event.preventDefault();
    return;
  }

  // Не отключаем submitter: его name/value могут быть частью серверного действия.
  if (form.dataset.submitting === 'true') {
    event.preventDefault();
    return;
  }
  form.dataset.submitting = 'true';
  form.setAttribute('aria-busy', 'true');
  const submitter = event.submitter;
  if (submitter) {
    submitter.setAttribute('aria-busy', 'true');
    submitter.setAttribute('aria-disabled', 'true');
    if (submitter.tagName === 'BUTTON' && !submitter.matches('[data-keep-label]')) {
      submitter.dataset.submitLabel = submitter.textContent;
      submitter.textContent = 'Сохраняем…';
    }
  }
});

// Фильтры применяются сразу при выборе значения.
document.addEventListener('change', (event) => {
  const el = event.target;
  if (el.matches('select[data-autosubmit]') && el.form) el.form.requestSubmit();
});

// Закрываем мобильное меню по Esc.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  const menu = document.querySelector('.mobile-menu[open]');
  if (menu) menu.removeAttribute('open');
});

// После выбора пункта меню возвращаем страницу к обычному состоянию.
document.addEventListener('click', (event) => {
  const menu = document.querySelector('.mobile-menu[open]');
  if (!menu) return;
  if (event.target.closest('.mobile-panel a') || !menu.contains(event.target)) menu.removeAttribute('open');
});

// Широкие таблицы получают клавиатурный фокус и понятную подсказку для скринридера.
function enhanceScrollableTables() {
  document.querySelectorAll('.table-wrap').forEach((wrap) => {
    const overflows = wrap.scrollWidth > wrap.clientWidth + 2;
    wrap.classList.toggle('is-overflowing', overflows);
    if (overflows) {
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', 'Таблица. Остальные столбцы доступны при горизонтальной прокрутке.');
      wrap.dataset.scrollEnhanced = 'true';
    } else if (wrap.dataset.scrollEnhanced === 'true') {
      wrap.removeAttribute('tabindex');
      wrap.removeAttribute('role');
      wrap.removeAttribute('aria-label');
      delete wrap.dataset.scrollEnhanced;
    }
  });
}

enhanceScrollableTables();
let resizeFrame;
window.addEventListener('resize', () => {
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(enhanceScrollableTables);
});

// Возврат из back/forward cache не должен оставлять форму визуально заблокированной.
window.addEventListener('pageshow', () => {
  document.querySelectorAll('form[data-submitting="true"]').forEach((form) => {
    delete form.dataset.submitting;
    form.removeAttribute('aria-busy');
    form.querySelectorAll('[aria-busy="true"], [aria-disabled="true"]').forEach((control) => {
      control.removeAttribute('aria-busy');
      control.removeAttribute('aria-disabled');
      if (control.dataset.submitLabel) {
        control.textContent = control.dataset.submitLabel;
        delete control.dataset.submitLabel;
      }
    });
  });
});

// На серверной ошибке сразу переводим внимание к сводке или первому проблемному полю.
const errorTarget = document.querySelector('[data-error-summary], [aria-invalid="true"]');
if (errorTarget) {
  if (!errorTarget.hasAttribute('tabindex') && !errorTarget.matches('input, select, textarea, button, a')) errorTarget.tabIndex = -1;
  errorTarget.focus({ preventScroll: true });
  errorTarget.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

// Обратный отсчёт до начала или окончания контеста (кейс №2). Время приходит с сервера в миллисекундах.
const countdowns = document.querySelectorAll('[data-countdown]');
if (countdowns.length) {
  const pad = (n) => String(n).padStart(2, '0');
  const render = () => {
    countdowns.forEach((el) => {
      const left = Math.max(0, Math.floor((Number(el.dataset.countdown) - Date.now()) / 1000));
      const days = Math.floor(left / 86400);
      const time = `${pad(Math.floor((left % 86400) / 3600))}:${pad(Math.floor((left % 3600) / 60))}:${pad(left % 60)}`;
      el.textContent = days ? `${days} д ${time}` : time;
    });
  };
  render();
  window.setInterval(render, 1000);
}
