// Interface strings, Russian. All locale dictionaries share the same keys; tests enforce parity.
export const UI_RU = Object.freeze({
  // Native desktop menu (macOS): the page passes these to the shell.
  menuReconnect: 'Переподключиться',
  menuReset: 'Вернуть на место',
  menuHide: 'Скрыть на этот запуск',
  menuQuit: 'Выйти',
  // Settings section (rendered inside Harness's own Settings panel).
  settingsIntro: 'Изменения применяются сразу.',
  size: 'Размер',
  opacity: 'Прозрачность',
  reducedMotion: 'Меньше движения',
  hover: 'Реакция на наведение',
  randomActs: 'Случайные выходки',
  meal: 'Перекусы',
  wallet: 'Кошелёк',
  wander: 'Прогулки',
  autoStartShell: 'Запускать вместе с Harness',
  locale: 'Язык облачка',
  skin: 'Скин',
  loading: 'Читаю настройки…',
  unavailable: 'Настройки недоступны: хост не хранит конфигурацию.',
  retry: 'Повторить',
  // Compact bubble over the pinned task: counts of its active helpers.
  teamTitle: 'Помощники: {summary}',
  teamActive: '{count} работают',
  teamWaiting: '{count} ждут',
  teamCompleted: '{count} завершили',
  teamErrors: '{count} с ошибкой',
  // Tooltip on the wallet bubble: real token counts, never a fabricated balance.
  usageTitle: 'Последняя работа: {total} токенов (вход {input}, выход {output})',
})
