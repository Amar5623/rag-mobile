// src/api/sse.js
//
// CHANGE: streamSSE() now accepts a `baseUrl` parameter so the active
// server URL from useNetwork.activeUrl can be used instead of the
// hardcoded Config.API_BASE_URL. Falls back to Config.API_BASE_URL when
// not provided (preserves backward compatibility).
//
// LOGGING ADDED: Every lifecycle event of the XHR SSE connection is logged
// via createLogger('sse') — connection open, each onprogress chunk, each
// parsed SSE event, [DONE] signal, errors, timeouts, and readyState changes.

import { Config } from '../config';
import { createLogger } from '../utils/logger';

// Module-level logger — all lines tagged [sse]
const log = createLogger('sse');

export function streamSSE(path, body, onEvent, onDone, onError, baseUrl) {
  const base = baseUrl || Config.API_BASE_URL;
  const xhr  = new XMLHttpRequest();
  const url  = `${base}${path}`;

  log.info('streamSSE() opening connection →', url);
  log.debug('streamSSE() request body:', JSON.stringify(body).slice(0, 300));

  xhr.open('POST', url, true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.setRequestHeader('Accept', 'text/event-stream');

  let lastIndex     = 0;
  let buffer        = '';
  let progressCount = 0;
  let tokenCount    = 0;
  const startMs     = Date.now();

  // ── onprogress: fired every time new bytes arrive ────────────────────────
  xhr.onprogress = () => {
    progressCount++;
    log.debug(
      `streamSSE onprogress #${progressCount}`,
      `responseText.length=${xhr.responseText?.length}`,
    );

    const newData = xhr.responseText.slice(lastIndex);
    lastIndex = xhr.responseText.length;

    log.debug('streamSSE new chunk raw:', JSON.stringify(newData.slice(0, 200)));

    buffer += newData;
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep any incomplete line

    for (const line of lines) {
      log.debug('streamSSE line:', JSON.stringify(line));

      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();

      if (raw === '[DONE]') {
        log.info('streamSSE received [DONE] after', Date.now() - startMs, 'ms,',
          tokenCount, 'tokens streamed');
        onDone?.();
        return;
      }

      try {
        const parsed = JSON.parse(raw);

        // Count tokens for telemetry logging
        if (parsed.token !== undefined) {
          tokenCount++;
          if (tokenCount === 1) {
            log.info('streamSSE first token received — time-to-first-token:',
              Date.now() - startMs, 'ms');
          }
        }

        log.debug('streamSSE parsed event:', JSON.stringify(parsed).slice(0, 200));
        onEvent(parsed);
      } catch (e) {
        log.warn('streamSSE JSON parse error:', e.message, '| raw was:', raw);
      }
    }
  };

  // ── onload: fired when the request completes ────────────────────────────
  xhr.onload = () => {
    log.info('streamSSE onload fired — status:', xhr.status,
      '| responseText.length:', xhr.responseText?.length,
      '| elapsed:', Date.now() - startMs, 'ms');
    log.debug('streamSSE final responseText (first 500):', xhr.responseText?.slice(0, 500));
    onDone?.();
  };

  // ── onerror: network-level failure ───────────────────────────────────────
  xhr.onerror = (e) => {
    log.error('streamSSE onerror — network failure after', Date.now() - startMs, 'ms:', e);
    onError?.(new Error('SSE connection failed'));
  };

  // ── ontimeout: exceeded xhr.timeout ──────────────────────────────────────
  xhr.ontimeout = () => {
    log.error('streamSSE ontimeout — exceeded 60s after', Date.now() - startMs, 'ms');
    onError?.(new Error('SSE timeout'));
  };

  // ── onreadystatechange: diagnostic — logs each state transition ──────────
  xhr.onreadystatechange = () => {
    const states = ['UNSENT', 'OPENED', 'HEADERS_RECEIVED', 'LOADING', 'DONE'];
    log.debug(
      `streamSSE readyState → ${states[xhr.readyState] || xhr.readyState}`,
      `(status=${xhr.status})`,
    );
  };

  // Set 60 s timeout (generous for large responses)
  xhr.timeout = 60_000;

  xhr.send(JSON.stringify(body));
  log.info('streamSSE request sent to', url);

  return xhr;
}