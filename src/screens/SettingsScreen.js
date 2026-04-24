// src/screens/SettingsScreen.js
//
// CHANGES:
//   - Added `cloud_url` and `local_url` fields (three-URL architecture).
//     Legacy `server_url` is still saved for backward compatibility.
//   - invalidateUrlCache() called after saving so next API call picks up the new URL.
//   - handleSync uses the saved local_url (or cloud_url) for the sync request.
//   - Sync feedback shows PDF counts.
//   - Added runtime failover: cloud is tried first on health check, then local.
//     If app is currently on local and cloud becomes healthy, it switches back to cloud.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchHealth, fetchStats } from '../api/kb';
import { apiFetch, invalidateUrlCache } from '../api/client';
import { getChunkCount, replaceAllChunks, setSyncMeta, getAllSyncMeta } from '../offline/db';
import { syncPdfs } from '../offline/pdfSync';
import { Config } from '../config';
import { colors, spacing, radius, typography, minTapTarget } from '../config/theme';

const normalizeUrl = (value) => (value || '').trim();

export function SettingsScreen() {
  // Three-URL architecture: cloud (primary), local (fallback), legacy single URL
  const [cloudUrl,     setCloudUrl]     = useState('');
  const [localUrl,     setLocalUrl]     = useState('');
  const [health,       setHealth]       = useState(null);
  const [stats,        setStats]        = useState(null);
  const [chunkCount,   setChunkCount]    = useState(null);
  const [checking,     setChecking]      = useState(false);
  const [saveFeedback, setSaveFeedback]  = useState('');

  // --- Sync state ---
  const [syncing,      setSyncing]      = useState(false);
  const [syncResult,   setSyncResult]   = useState(null);
  const [lastSynced,   setLastSynced]   = useState(null);

  // Runtime-selected server URL (cloud if healthy, otherwise local)
  const [activeUrl,    setActiveUrl]    = useState(normalizeUrl(Config.API_BASE_URL || Config.LOCAL_URL));
  const [activeSource, setActiveSource] = useState('local');

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem('cloud_url'),
      AsyncStorage.getItem('local_url'),
    ]).then(([c, l]) => {
      setCloudUrl(c || Config.CLOUD_URL);
      setLocalUrl(l || Config.LOCAL_URL);

      // Keep the base URL behavior as-is: start from the local/base server.
      setActiveUrl(normalizeUrl(Config.API_BASE_URL || l || Config.LOCAL_URL || Config.CLOUD_URL));
      setActiveSource('local');
    });

    getChunkCount().then(setChunkCount).catch(() => setChunkCount(0));
    getAllSyncMeta().then(meta => {
      if (meta.last_synced) setLastSynced(meta.last_synced);
    }).catch(() => {});
  }, []);

  const saveUrls = async () => {
    await Promise.all([
      AsyncStorage.setItem('cloud_url', cloudUrl.trim()),
      AsyncStorage.setItem('local_url', localUrl.trim()),
      // Keep legacy key in sync so old code paths still work
      AsyncStorage.setItem('server_url', (localUrl.trim() || cloudUrl.trim())),
    ]);
    invalidateUrlCache(); // force client.js to re-read on next request
    setSaveFeedback('Saved ✓');
    setTimeout(() => setSaveFeedback(''), 2000);
  };

  const probeUrl = useCallback(async (url) => {
    const target = normalizeUrl(url);
    if (!target) return false;

    try {
      const h = await fetchHealth(null, target);
      return Boolean(h && !h.error && h.is_online !== false);
    } catch {
      return false;
    }
  }, []);

  // Cloud first, then local, then configured fallback
  const resolvePreferredUrl = useCallback(async () => {
    const cloud = normalizeUrl(cloudUrl || Config.CLOUD_URL);
    const local = normalizeUrl(localUrl || Config.LOCAL_URL);
    const fallback = normalizeUrl(Config.API_BASE_URL || Config.LOCAL_URL || local || cloud);

    if (await probeUrl(cloud)) {
      return { url: cloud, source: 'cloud' };
    }

    if (await probeUrl(local)) {
      return { url: local, source: 'local' };
    }

    return { url: fallback, source: 'fallback' };
  }, [cloudUrl, localUrl, probeUrl]);

  // Resolve and update runtime URL if needed.
  // This keeps the current base/local default, but allows switching to cloud when healthy.
  const syncRuntimeUrl = useCallback(async () => {
    const resolved = await resolvePreferredUrl();

    if (resolved.url && resolved.url !== activeUrl) {
      setActiveUrl(resolved.url);
      setActiveSource(resolved.source);

      // Keep old code paths working
      await AsyncStorage.setItem('server_url', resolved.url);
      invalidateUrlCache();
    }

    return resolved;
  }, [resolvePreferredUrl, activeUrl]);

  // Determine the current runtime URL (default remains local/base)
  const getActiveUrl = useCallback(() => {
    return activeUrl || normalizeUrl(Config.API_BASE_URL || Config.LOCAL_URL || localUrl || cloudUrl);
  }, [activeUrl, localUrl, cloudUrl]);

  const checkHealth = async () => {
    setChecking(true);
    setHealth(null);
    setStats(null);
    try {
      // Try cloud first; if cloud is unavailable, fall back to local.
      // If we are currently on local and cloud is healthy again, this switches back to cloud.
      const resolved = await syncRuntimeUrl();
      const url = resolved.url;

      const [h, s] = await Promise.all([
        fetchHealth(null, url),
        fetchStats(url).catch(() => null),
      ]);

      setHealth(h);
      setStats(s);

      // Make the runtime selection visible to the rest of the screen/app
      setActiveUrl(url);
      setActiveSource(resolved.source);
    } catch (e) {
      setHealth({ error: e.message });
    } finally {
      setChecking(false);
    }
  };

  // Manual sync handler — pulls all chunks from /kb/export and all PDFs
  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncResult(null);

    try {
      // Re-evaluate before syncing so the app can move back to cloud if it is healthy again.
      const resolved = await syncRuntimeUrl();
      const activeUrl = resolved.url || getActiveUrl();

      // 1. Fetch all chunks from /kb/export
      const res    = await apiFetch('/kb/export', activeUrl);
      const data   = await res.json();
      const chunks = data.chunks || [];

      // 2. Atomically wipe + repopulate local SQLite (chunks + FTS index)
      await replaceAllChunks(chunks);

      // 3. Sync PDFs — downloads new ones, removes stale ones
      const pdfResult = await syncPdfs(activeUrl);

      // 4. Persist sync metadata
      const now = new Date().toISOString();
      await setSyncMeta('last_synced', now);
      await setSyncMeta('chunk_count', String(chunks.length));

      // 5. Refresh displayed chunk count
      const count = await getChunkCount();
      setChunkCount(count);
      setLastSynced(now);

      setSyncResult({
        chunks:      chunks.length,
        pdfsSynced:  pdfResult.synced.length,
        pdfsDeleted: pdfResult.deleted.length,
        errors:      pdfResult.errors,
      });
    } catch (e) {
      setSyncResult({ error: e.message });
    } finally {
      setSyncing(false);
    }
  }, [syncing, syncRuntimeUrl, getActiveUrl]);

  const healthColor =
    !health          ? colors.text3 :
    health.error     ? colors.error :
    health.is_online ? colors.online :
                       colors.intranet;

  const healthLabel =
    !health          ? '—' :
    health.error     ? `Error: ${health.error}` :
    health.is_online ? 'Online — Groq available' :
                       'Server up — no internet (at-sea mode)';

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.heading}>Settings</Text>

      {/* ── Server URLs ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Server URLs</Text>
        <Text style={styles.cardHint}>
          Cloud URL (primary — Mode 1 with internet, Mode 2 without):{'\n'}
          Leave blank if only using a local server.
        </Text>
        <TextInput
          style={styles.input}
          value={cloudUrl}
          onChangeText={setCloudUrl}
          placeholder="http://192.168.1.10:8001  (optional)"
          placeholderTextColor={colors.text3}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <Text style={[styles.cardHint, { marginTop: spacing.xs }]}>
          Local URL (fallback — used when cloud is unreachable):{'\n'}
          Android emulator: http://10.0.2.2:8000
        </Text>
        <TextInput
          style={styles.input}
          value={localUrl}
          onChangeText={setLocalUrl}
          placeholder="http://192.168.1.10:8000"
          placeholderTextColor={colors.text3}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />

        <TouchableOpacity style={styles.btn} onPress={saveUrls} activeOpacity={0.8}>
          <Text style={styles.btnText}>{saveFeedback || 'Save URLs'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Server Health ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Server Status</Text>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={checkHealth}
          disabled={checking}
          activeOpacity={0.8}
        >
          {checking
            ? <ActivityIndicator size="small" color={colors.accent} />
            : <Text style={styles.btnTextSecondary}>Check Server Health</Text>
          }
        </TouchableOpacity>

        {health && (
          <View style={styles.healthRow}>
            <View style={[styles.healthDot, { backgroundColor: healthColor }]} />
            <Text style={[styles.healthLabel, { color: healthColor }]}>{healthLabel}</Text>
          </View>
        )}

        {stats && (
          <View style={styles.statGrid}>
            <StatRow label="Vectors indexed" value={stats.total_vectors?.toLocaleString() || '0'} />
            <StatRow label="BM25 documents"  value={stats.bm25_docs?.toLocaleString()     || '0'} />
            <StatRow label="Embedding model" value={stats.embedding_model                 || '—'} />
            <StatRow label="LLM model"       value={stats.llm_model                       || '—'} />
          </View>
        )}
      </View>

      {/* ── Local Database ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Local Database</Text>
        <View style={styles.statGrid}>
          <StatRow
            label="Cached chunks"
            value={chunkCount === null ? '…' : chunkCount.toLocaleString()}
          />
          {lastSynced && (
            <StatRow
              label="Last synced"
              value={new Date(lastSynced).toLocaleString()}
            />
          )}
        </View>

        {/* Sync button — pulls chunks + PDFs from server into local SQLite */}
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={handleSync}
          disabled={syncing}
          activeOpacity={0.8}
        >
          {syncing
            ? <ActivityIndicator size="small" color={colors.accent} />
            : <Text style={styles.btnTextSecondary}>⬇  Sync from Server</Text>
          }
        </TouchableOpacity>

        {/* Sync result feedback */}
        {syncResult && !syncResult.error && (
          <View style={styles.healthRow}>
            <View style={[styles.healthDot, { backgroundColor: colors.success }]} />
            <Text style={[styles.healthLabel, { color: colors.success }]}>
              Synced {syncResult.chunks.toLocaleString()} chunks
              {syncResult.pdfsSynced  > 0 ? ` · ${syncResult.pdfsSynced} PDFs downloaded` : ''}
              {syncResult.pdfsDeleted > 0 ? ` · ${syncResult.pdfsDeleted} removed`         : ''}
            </Text>
          </View>
        )}
        {syncResult?.error && (
          <View style={styles.healthRow}>
            <View style={[styles.healthDot, { backgroundColor: colors.error }]} />
            <Text style={[styles.healthLabel, { color: colors.error }]}>
              Sync failed: {syncResult.error}
            </Text>
          </View>
        )}

        <Text style={styles.cardHint}>
          Synced automatically when server becomes reachable.{'\n'}
          Powers local search in deep-offline mode.
        </Text>
      </View>

      {/* ── About ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>About</Text>
        <Text style={styles.aboutText}>
          MarineDoc v1.0  ·  Hybrid RAG Ship Manual Assistant{'\n\n'}
          Mode 1 — Online: AI-powered answers (Groq){'\n'}
          Mode 2 — At Sea: Manual section retrieval{'\n'}
          Mode 3 — Offline: Local SQLite full-text search
        </Text>
      </View>
    </ScrollView>
  );
}

function StatRow({ label, value }) {
  return (
    <View style={statStyles.row}>
      <Text style={statStyles.label}>{label}</Text>
      <Text style={statStyles.value}>{value}</Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  row:   {
    flexDirection:   'row',
    justifyContent:  'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  label: { fontSize: typography.fontSize.sm, color: colors.text2 },
  value: { fontSize: typography.fontSize.sm, color: colors.teal, fontFamily: typography.fontMono },
});

const styles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: colors.bg0 },
  content: { padding: spacing.lg, paddingBottom: 60 },
  heading: {
    fontSize:     typography.fontSize.xxl,
    color:        colors.text0,
    fontWeight:   '700',
    marginBottom: spacing.xl,
    letterSpacing: -0.5,
  },
  card: {
    backgroundColor: colors.bg2,
    borderRadius:    radius.lg,
    borderWidth:     1,
    borderColor:     colors.border,
    padding:         spacing.lg,
    marginBottom:    spacing.lg,
    gap:             spacing.md,
  },
  cardTitle: {
    fontSize:     typography.fontSize.lg,
    color:        colors.text0,
    fontWeight:   '600',
    marginBottom: spacing.xs,
  },
  cardHint: {
    fontSize:   typography.fontSize.sm,
    color:      colors.text3,
    lineHeight: 20,
  },
  input: {
    backgroundColor:   colors.bg4,
    borderWidth:       1,
    borderColor:       colors.borderMd,
    borderRadius:      radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical:   12,
    color:             colors.text0,
    fontSize:          typography.fontSize.md,
    minHeight:         minTapTarget,
    fontFamily:        typography.fontMono,
  },
  btn: {
    backgroundColor: colors.accent,
    borderRadius:    radius.md,
    paddingVertical: 12,
    alignItems:      'center',
    justifyContent:  'center',
    minHeight:       minTapTarget,
  },
  btnText:          { color: '#fff', fontWeight: '600', fontSize: typography.fontSize.md },
  btnSecondary:     { backgroundColor: colors.bg3, borderWidth: 1, borderColor: colors.borderMd },
  btnTextSecondary: { color: colors.text1, fontWeight: '600', fontSize: typography.fontSize.md },

  healthRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xs },
  healthDot:  { width: 8, height: 8, borderRadius: 4 },
  healthLabel:{ fontSize: typography.fontSize.sm, flex: 1, lineHeight: 20 },

  statGrid: { gap: 2 },

  aboutText: {
    fontSize:   typography.fontSize.sm,
    color:      colors.text2,
    lineHeight: 22,
    fontFamily: typography.fontMono,
  },
});