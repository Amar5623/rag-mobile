// src/api/chat.js
import { streamSSE } from './sse';
import { apiFetch }  from './client';

// Online — XHR-based SSE streaming
// Returns an abort function so useChat can cancel mid-stream
export function streamChat(question, sessionId = 'default', pinnedFile = null, callbacks = {}) {
  const body = { question, session_id: sessionId };
  if (pinnedFile) body.pinned_file = pinnedFile;

  const xhr = streamSSE(
    '/chat/stream',
    body,
    callbacks.onEvent,
    callbacks.onDone,
    callbacks.onError,
  );

  return () => xhr?.abort(); // returns cancel fn
}

// Offline — plain JSON response from server
export async function fetchOfflineResponse(question, pinnedFile = null) {
  const body = { question };
  if (pinnedFile) body.pinned_file = pinnedFile;

  const res = await apiFetch('/chat/offline', {
    method: 'POST',
    body:   JSON.stringify(body),
  });
  return res.json();
}

export async function clearSession(sessionId = 'default') {
  await apiFetch('/chat/clear', {
    method: 'POST',
    body:   JSON.stringify({ session_id: sessionId }),
  });
}