// src/api/kb.js
//
// CHANGE: fetchHealth() now accepts an explicit `baseUrl` parameter so
// useNetwork can probe arbitrary URLs (cloud and local) without going
// through the cached AsyncStorage lookup.
// The function still works with no arguments — falls back to getBaseUrl().
//
// LOGGING ADDED: Every health probe, stats fetch, and documents fetch is
// logged via createLogger('kb') with URL, outcome, and timing so probe
// results are visible for each network mode determination.

import { apiFetch, getBaseUrl } from './client';
import { createLogger } from '../utils/logger';

// Module-level logger — all lines tagged [kb]
const log = createLogger('kb');

/**
 * Health probe — used by useNetwork to determine the current network mode.
 *
 * @param {AbortSignal|null} signal  — optional abort signal for timeout control
 * @param {string}           baseUrl — URL to probe (defaults to stored server URL)
 */
export async function fetchHealth(signal, baseUrl) {
  const base    = baseUrl || await getBaseUrl();
  const probeUrl = `${base}/health`;
  const startMs = Date.now();

  log.info('fetchHealth() → probing:', probeUrl);

  try {
    const res  = await fetch(probeUrl, {
      signal,
      headers: { 'Content-Type': 'application/json' },
    });

    const elapsed = Date.now() - startMs;

    if (!res.ok) {
      log.warn(`fetchHealth() HTTP ${res.status} from ${probeUrl} (${elapsed}ms)`);
      throw new Error(`Health check failed: ${res.status}`);
    }

    const data = await res.json(); // { status, is_online, groq_configured }

    log.info(`fetchHealth() OK (${elapsed}ms)`, {
      url:              probeUrl,
      status:           data.status,
      is_online:        data.is_online,
      groq_configured:  data.groq_configured,
    });

    return data;
  } catch (err) {
    const elapsed = Date.now() - startMs;
    if (err.name === 'AbortError') {
      log.warn(`fetchHealth() ABORTED (${elapsed}ms) for:`, probeUrl);
    } else {
      log.warn(`fetchHealth() FAILED (${elapsed}ms) for ${probeUrl}:`, err.message);
    }
    throw err;
  }
}

/**
 * Fetch server-side vector/BM25 stats.
 * @param {string} activeUrl — base URL from useNetwork
 */
export async function fetchStats(activeUrl = '') {
  log.info('fetchStats() → GET /stats', activeUrl ? `(url: ${activeUrl})` : '(default url)');
  try {
    const data = await apiFetch('/stats', activeUrl).then(r => r.json());
    log.info('fetchStats() SUCCESS:', {
      total_vectors:  data.total_vectors,
      bm25_docs:      data.bm25_docs,
      embedding_model: data.embedding_model,
      llm_model:       data.llm_model,
    });
    return data;
  } catch (err) {
    log.error('fetchStats() FAILED:', err.message);
    throw err;
  }
}

/**
 * Fetch list of documents on the server.
 * @param {string} activeUrl — base URL from useNetwork
 */
export async function fetchDocuments(activeUrl = '') {
  log.info('fetchDocuments() → GET /documents', activeUrl ? `(url: ${activeUrl})` : '(default url)');
  try {
    const data = await apiFetch('/documents', activeUrl).then(r => r.json());
    log.info('fetchDocuments() SUCCESS — file count:', data.files?.length ?? 0);
    log.debug('fetchDocuments() files:', data.files);
    return data;
  } catch (err) {
    log.error('fetchDocuments() FAILED:', err.message);
    throw err;
  }
}