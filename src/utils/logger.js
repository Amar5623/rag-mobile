// src/utils/logger.js
//
// Centralised logger for the rag-mobile app.
// Wraps console.log/warn/error with:
//   - A consistent timestamp prefix:  [HH:MM:SS.mmm]
//   - A module/tag label:             [TAG]
//   - A log-level prefix:             INFO | WARN | ERROR | DEBUG
//
// Usage:
//   import { createLogger } from '../utils/logger';
//   const log = createLogger('useChat');
//
//   log.info('send() called', { question, mode });   // [12:34:56.789] [useChat] INFO  send() called {...}
//   log.warn('Retry attempt', 2);                    // [12:34:56.789] [useChat] WARN  Retry attempt 2
//   log.error('Fetch failed', err);                  // [12:34:56.789] [useChat] ERROR Fetch failed Error{...}
//   log.debug('Raw SSE chunk', raw);                 // only emitted when DEBUG_LOGGING=true
//
// Global log level control:
//   Set Logger.level to 'debug' | 'info' | 'warn' | 'error' | 'silent'
//   Default is 'debug' in __DEV__ builds, 'info' in production.

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

// ── Global config object (module-level singleton) ──────────────────────────
export const Logger = {
  // Default level: show everything in dev builds, hide debug in prod
  level: typeof __DEV__ !== 'undefined' && __DEV__ ? 'debug' : 'info',

  // Set to false to suppress all output (e.g. in tests)
  enabled: true,
};

// ── Timestamp helper ───────────────────────────────────────────────────────
function timestamp() {
  const d   = new Date();
  const hh  = String(d.getHours()).padStart(2, '0');
  const mm  = String(d.getMinutes()).padStart(2, '0');
  const ss  = String(d.getSeconds()).padStart(2, '0');
  const ms  = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

// ── Core emit ─────────────────────────────────────────────────────────────
function emit(level, tag, args) {
  if (!Logger.enabled) return;
  if (LEVELS[level] < LEVELS[Logger.level]) return;

  const prefix = `[${timestamp()}] [${tag}] ${level.toUpperCase().padEnd(5)}`;

  switch (level) {
    case 'error': console.error(prefix, ...args); break;
    case 'warn':  console.warn(prefix,  ...args); break;
    default:      console.log(prefix,   ...args); break;
  }
}

// ── Factory ───────────────────────────────────────────────────────────────

/**
 * createLogger(tag)
 *
 * Returns a { debug, info, warn, error } object whose methods each prepend
 * a timestamp and the module tag before delegating to console.*.
 *
 * @param {string} tag  — short module name shown in every log line
 */
export function createLogger(tag) {
  return {
    debug: (...args) => emit('debug', tag, args),
    info:  (...args) => emit('info',  tag, args),
    warn:  (...args) => emit('warn',  tag, args),
    error: (...args) => emit('error', tag, args),
  };
}

// ── Default export (convenience) ──────────────────────────────────────────
export default createLogger;