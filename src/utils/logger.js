// System logowania - ujednolicone logi dla całego bota

const levels = {
  INFO: 'INFO',
  SUCCESS: 'SUCCESS',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG',
};

/**
 * Loguje wiadomość z odpowiednim poziomem i timestampem
 * @param {string} level - Poziom logowania (INFO, SUCCESS, WARNING, ERROR, DEBUG)
 * @param {string} message - Treść wiadomości
 * @param {*} [data] - Opcjonalne dane dodatkowe
 */
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level}]`;

  if (level === 'ERROR') {
    console.error(`${prefix} ${message}`);
    if (data) console.error(data);
  } else if (level === 'WARNING') {
    console.warn(`${prefix} ${message}`);
    if (data) console.warn(data);
  } else {
    console.log(`${prefix} ${message}`);
    if (data) console.log(data);
  }
}

module.exports = {
  info: (message, data) => log(levels.INFO, message, data),
  success: (message, data) => log(levels.SUCCESS, message, data),
  warn: (message, data) => log(levels.WARNING, message, data),
  error: (message, data) => log(levels.ERROR, message, data),
  debug: (message, data) => {
    if (process.env.NODE_ENV !== 'production') {
      log(levels.DEBUG, message, data);
    }
  },
};
