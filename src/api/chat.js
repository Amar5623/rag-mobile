// src/api/chat.js
//
// CHANGE: Both streamChat() and fetchOfflineResponse() now accept an
// `activeUrl` parameter so the URL resolved by useNetwork.activeUrl is
// used directly instead of the cached AsyncStorage value.
// clearSession() also accepts activeUrl for consistency.
//
// LOGGING ADDED: Every entry point and key step is logged via
// createLogger('chat') so the full online/offline request path is
// visible in the console from call to response.

import { streamSSE } from './sse';
import { apiFetch }  from './client';
import { createLogger } from '../utils/logger';

// Module-level logger — all lines tagged [chat]
const log = createLogger('chat');

/**
 * Online — XHR-based SSE streaming.
 * Returns an abort function so useChat can cancel mid-stream.
 *
 * @param {string}   question
 * @param {string}   sessionId
 * @param {string|null} pinnedFile
 * @param {object}   callbacks  — { onEvent, onDone, onError }
 * @param {string}   activeUrl  — base URL from useNetwork (e.g. 'http://192.168.1.X:8001')
 */
export function streamChat(
  question,
  sessionId   = 'default',
  pinnedFile  = null,
  callbacks   = {},
  activeUrl   = '',
) {
  log.info('streamChat() START', {
    question: question.slice(0, 100),
    sessionId,
    pinnedFile: pinnedFile || '(none)',
    activeUrl:  activeUrl  || '(fallback to config)',
  });

  const body = { question, session_id: sessionId };
  if (pinnedFile) {
    body.pinned_file = pinnedFile;
    log.debug('streamChat() pinned file added to body:', pinnedFile);
  }

  log.debug('streamChat() body prepared, opening SSE stream …');

  const xhr = streamSSE(
    '/chat/stream',
    body,
    (event) => {
      // Delegate to the caller's onEvent; debug-log non-token events
      if (event.token === undefined) {
        log.debug('streamChat() non-token event received:', JSON.stringify(event).slice(0, 200));
      }
      callbacks.onEvent?.(event);
    },
    () => {
      log.info('streamChat() SSE stream DONE (onDone callback)');
      callbacks.onDone?.();
    },
    (err) => {
      log.error('streamChat() SSE stream ERROR:', err.message);
      callbacks.onError?.(err);
    },
    activeUrl, // passed to streamSSE as baseUrl
  );

  // Return cancel function
  const cancel = () => {
    log.info('streamChat() CANCELLED by caller');
    xhr?.abort();
  };
  return cancel;
}

/**
 * Offline — plain JSON response from server (Mode 2).
 *
 * @param {string}      question
 * @param {string|null} pinnedFile
 * @param {string}      activeUrl  — base URL from useNetwork
 */
export async function fetchOfflineResponse(
  question,
  pinnedFile = null,
  activeUrl  = '',
) {
  log.info('fetchOfflineResponse() START', {
    question:   question.slice(0, 100),
    pinnedFile: pinnedFile || '(none)',
    activeUrl:  activeUrl  || '(fallback to config)',
  });

  const body = { question };
  if (pinnedFile) {
    body.pinned_file = pinnedFile;
    log.debug('fetchOfflineResponse() pinned file added:', pinnedFile);
  }

  log.debug('fetchOfflineResponse() → POST /chat/offline');

  try {
    const res  = await apiFetch('/chat/offline', activeUrl, {
      method: 'POST',
      body:   JSON.stringify(body),
    });
    const data = await res.json();

    log.info('fetchOfflineResponse() SUCCESS — chunks returned:',
      data.chunks?.length ?? '(no chunks field)');
    log.debug('fetchOfflineResponse() response:', JSON.stringify(data).slice(0, 500));

    return data;
  } catch (err) {
    log.error('fetchOfflineResponse() FAILED:', err.message);
    throw err;
  }
}

/**
 * Clear the server-side session history.
 *
 * @param {string} sessionId
 * @param {string} activeUrl  — base URL from useNetwork
 */
export async function clearSession(sessionId = 'default', activeUrl = '') {
  log.info('clearSession() called for session:', sessionId,
    '| url:', activeUrl || '(fallback to config)');

  try {
    await apiFetch('/chat/clear', activeUrl, {
      method: 'POST',
      body:   JSON.stringify({ session_id: sessionId }),
    });
    log.info('clearSession() SUCCESS — session cleared:', sessionId);
  } catch (err) {
    log.warn('clearSession() FAILED (ignored if offline):', err.message);
    throw err;
  }
}