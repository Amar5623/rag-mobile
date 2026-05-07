// src/offline/pdfSync.js
//
// CHANGE: syncPdfs() and getLocalPdfUri() now accept an optional `activeUrl`
// parameter so the correct server URL (from useNetwork.activeUrl) is used
// instead of the cached Config.API_BASE_URL.
//
// LOGGING ADDED: Every step of the PDF sync pipeline — directory creation,
// /documents fetch, server-vs-local comparison, each individual download,
// each deletion, final summary — and getLocalPdfUri() lookups are all
// logged via createLogger('pdfSync').

import * as FileSystem from 'expo-file-system/legacy';  // ← legacy import fixes warning
import { apiFetch }    from '../api/client';
import { Config }      from '../config';
import { createLogger } from '../utils/logger';

// Module-level logger — all lines tagged [pdfSync]
const log = createLogger('pdfSync');

export const PDF_DIR = FileSystem.documentDirectory + 'pdfs/';

async function ensurePdfDir() {
  log.debug('ensurePdfDir() — checking:', PDF_DIR);
  const info = await FileSystem.getInfoAsync(PDF_DIR);
  if (!info.exists) {
    log.info('ensurePdfDir() — directory not found, creating:', PDF_DIR);
    await FileSystem.makeDirectoryAsync(PDF_DIR, { intermediates: true });
    log.info('ensurePdfDir() ✅ directory created');
  } else {
    log.debug('ensurePdfDir() — directory already exists');
  }
}

/**
 * Returns local file URI if the PDF is cached, or null.
 */
export async function getLocalPdfUri(filename) {
  log.debug('getLocalPdfUri() — checking:', filename);
  try {
    const path = PDF_DIR + filename;
    const info = await FileSystem.getInfoAsync(path);
    if (info.exists) {
      log.debug('getLocalPdfUri()', filename, '→ cached at:', path);
      return path;
    }
    log.debug('getLocalPdfUri()', filename, '→ not cached');
    return null;
  } catch (err) {
    log.warn('getLocalPdfUri() error for', filename, ':', err.message, '→ null');
    return null;
  }
}

/**
 * Sync all PDFs from the server.
 * Downloads any PDFs not cached locally.
 * Removes PDFs no longer on the server.
 *
 * @param {string} activeUrl — base URL from useNetwork (optional, falls back to Config)
 */
export async function syncPdfs(activeUrl = '') {
  const base = activeUrl || Config.API_BASE_URL;
  log.info('syncPdfs() START — base URL:', base);

  const startMs = Date.now();
  await ensurePdfDir();

  // ── 1. Fetch list of PDFs from server ─────────────────────────────────
  let serverFiles = [];
  try {
    log.info('syncPdfs() → GET /documents');
    const res  = await apiFetch('/documents', activeUrl);
    const data = await res.json();
    serverFiles = (data.files || []).filter(
      f => typeof f === 'string' && f.toLowerCase().endsWith('.pdf')
    );
    log.info('syncPdfs() server has', serverFiles.length, 'PDF(s):', serverFiles.join(', ') || '(none)');
  } catch (e) {
    log.error('syncPdfs() /documents FAILED:', e.message, '— aborting PDF sync');
    return { synced: [], deleted: [], errors: [e.message] };
  }

  // ── 2. List locally cached PDFs ────────────────────────────────────────
  let localFiles = [];
  try {
    localFiles = await FileSystem.readDirectoryAsync(PDF_DIR);
    log.info('syncPdfs() local cache has', localFiles.length, 'file(s):', localFiles.join(', ') || '(none)');
  } catch (err) {
    log.warn('syncPdfs() could not read PDF_DIR:', err.message, '— assuming empty');
    localFiles = [];
  }

  const serverSet = new Set(serverFiles);
  const localSet  = new Set(localFiles);
  const synced    = [];
  const deleted   = [];
  const errors    = [];

  // ── 3. Download missing PDFs ───────────────────────────────────────────
  const toDownload = serverFiles.filter(f => !localSet.has(f));
  log.info('syncPdfs() PDFs to download:', toDownload.length,
    toDownload.length ? `(${toDownload.join(', ')})` : '');

  for (const filename of toDownload) {
    const remoteUrl = `${base}/pdfs/${encodeURIComponent(filename)}`;
    const localPath = PDF_DIR + filename;

    log.info('syncPdfs() ↓ downloading:', filename, '←', remoteUrl);
    const dlStart = Date.now();

    try {
      const result = await FileSystem.downloadAsync(remoteUrl, localPath);
      const elapsed = Date.now() - dlStart;

      if (result.status === 200) {
        log.info(`syncPdfs() ✅ downloaded ${filename} in ${elapsed}ms`);
        synced.push(filename);
      } else {
        log.warn(`syncPdfs() ✗ download failed for ${filename}: HTTP ${result.status}`);
        errors.push(`${filename}: HTTP ${result.status}`);
      }
    } catch (e) {
      const elapsed = Date.now() - dlStart;
      log.error(`syncPdfs() ✗ download exception for ${filename} (${elapsed}ms):`, e.message);
      errors.push(`${filename}: ${e.message}`);
    }
  }

  // ── 4. Delete stale PDFs ───────────────────────────────────────────────
  const toDelete = localFiles.filter(f => !serverSet.has(f));
  log.info('syncPdfs() PDFs to delete:', toDelete.length,
    toDelete.length ? `(${toDelete.join(', ')})` : '');

  for (const filename of toDelete) {
    log.info('syncPdfs() 🗑 deleting stale file:', filename);
    try {
      await FileSystem.deleteAsync(PDF_DIR + filename, { idempotent: true });
      log.info('syncPdfs() ✅ deleted:', filename);
      deleted.push(filename);
    } catch (e) {
      log.error('syncPdfs() ✗ delete failed for', filename, ':', e.message);
      errors.push(`delete ${filename}: ${e.message}`);
    }
  }

  // ── 5. Summary ────────────────────────────────────────────────────────
  const elapsed = Date.now() - startMs;
  log.info(
    `syncPdfs() ✅ DONE in ${elapsed}ms —`,
    `↓${synced.length} downloaded,`,
    `🗑${deleted.length} deleted,`,
    `✗${errors.length} errors`,
    errors.length ? `| errors: ${errors.join('; ')}` : '',
  );

  return { synced, deleted, errors };
}