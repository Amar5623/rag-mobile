// src/hooks/useNetwork.js
//
// CHANGE: Full rewrite for three-URL network architecture.
//   - Exports `NetworkMode` constant (was missing — caused silent bug in useOfflineSearch)
//   - Sequential probe: cloud URL first → local URL fallback → deep_offline
//   - Returns `activeUrl` (the URL currently working) so all API calls use the right server
//   - Probe interval reduced to 15s (was 30s) for faster mode transitions
//   - Each health probe has a 4s timeout (was 5s)
//
// LOGGING ADDED: Every probe attempt, result, mode transition, and URL resolution
// is logged via createLogger('useNetwork') so the full connectivity detection
// flow is traceable in the console from startup through every poll cycle.

import { useState, useEffect, useRef, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Config } from '../config';
import { createLogger } from '../utils/logger';

// Module-level logger — all lines tagged [useNetwork]
const log = createLogger('useNetwork');

// Exported so useOfflineSearch (and any other hook) can import it
export const NetworkMode = {
  FULL_ONLINE:   'full_online',
  INTRANET_ONLY: 'intranet_only',
  DEEP_OFFLINE:  'deep_offline',
};

const PROBE_INTERVAL_MS = 15_000;  // probe every 15s
const PROBE_TIMEOUT_MS  = 4_000;   // 4s per health check

/**
 * Probe a single server URL.
 * Returns { reachable, isOnline } — never throws.
 */
async function probeHealth(baseUrl) {
  if (!baseUrl) {
    log.debug('probeHealth() skipped — baseUrl is empty');
    return { reachable: false, isOnline: false };
  }

  const probeUrl   = `${baseUrl}/health`;
  const controller = new AbortController();
  const timer      = setTimeout(() => {
    log.warn('probeHealth() TIMEOUT (4s) for:', probeUrl);
    controller.abort();
  }, PROBE_TIMEOUT_MS);

  log.debug('probeHealth() → probing:', probeUrl);
  const startMs = Date.now();

  try {
    const res  = await fetch(probeUrl, {
      signal:  controller.signal,
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    const elapsed = Date.now() - startMs;

    log.info(`probeHealth() OK (${elapsed}ms)`, {
      url:       probeUrl,
      reachable: true,
      isOnline:  data.is_online ?? false,
      status:    data.status,
    });

    return { reachable: true, isOnline: data.is_online ?? false };
  } catch (err) {
    const elapsed = Date.now() - startMs;
    if (err.name === 'AbortError') {
      log.warn(`probeHealth() ABORTED after ${elapsed}ms for:`, probeUrl);
    } else {
      log.warn(`probeHealth() UNREACHABLE (${elapsed}ms) for ${probeUrl}:`, err.message);
    }
    return { reachable: false, isOnline: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Three-state network hook.
 *
 * Reads `cloud_url` and `local_url` from AsyncStorage (set in SettingsScreen).
 * Probes cloud first, falls back to local.
 *
 * Returns:
 *   mode         — 'full_online' | 'intranet_only' | 'deep_offline'
 *   activeUrl    — the URL currently being used for API calls (empty string if deep_offline)
 *   cloudStatus  — { reachable, isOnline } or null
 *   localStatus  — { reachable, isOnline } or null
 *   serverReachable   — convenience bool for NetworkBanner
 *   serverHasInternet — convenience bool for NetworkBanner
 *   probe        — call to force an immediate re-probe
 */
export function useNetwork() {
  const [mode,         setMode]         = useState(NetworkMode.FULL_ONLINE);
  const [activeUrl,    setActiveUrl]    = useState('');
  const [cloudStatus,  setCloudStatus]  = useState(null);
  const [localStatus,  setLocalStatus]  = useState(null);
  const timerRef   = useRef(null);
  // Track previous mode to log transitions
  const prevModeRef = useRef(null);

  const probe = useCallback(async () => {
    log.info('probe() START — reading URLs from AsyncStorage');

    // Always load URLs fresh — user may have updated settings since last probe
    const cloudUrl = (await AsyncStorage.getItem('cloud_url') || '').trim();
    const localUrl = (await AsyncStorage.getItem('local_url') || '').trim() || Config.API_BASE_URL;

    log.info('probe() URLs resolved', {
      cloudUrl: cloudUrl || '(not set)',
      localUrl,
    });

    // 1. Try cloud
    let cloudResult = { reachable: false, isOnline: false };
    if (cloudUrl) {
      log.info('probe() STEP 1 — probing cloud URL:', cloudUrl);
      cloudResult = await probeHealth(cloudUrl);
      setCloudStatus(cloudResult);
      log.info('probe() cloud result:', cloudResult);
    } else {
      log.debug('probe() STEP 1 — no cloud URL configured, skipping');
    }

    // 2. Always try local
    log.info('probe() STEP 2 — probing local URL:', localUrl);
    const localResult = await probeHealth(localUrl);
    setLocalStatus(localResult);
    log.info('probe() local result:', localResult);

    // 3. Derive mode — cloud takes priority over local
    let newMode;
    let newActiveUrl;

    if (cloudResult.reachable && cloudResult.isOnline) {
      newMode      = NetworkMode.FULL_ONLINE;
      newActiveUrl = cloudUrl;
      log.info('probe() DECISION: FULL_ONLINE via cloud URL:', cloudUrl);
    } else if (cloudResult.reachable && !cloudResult.isOnline) {
      // Cloud server up but no internet — use it for retrieval (Mode 2)
      newMode      = NetworkMode.INTRANET_ONLY;
      newActiveUrl = cloudUrl;
      log.info('probe() DECISION: INTRANET_ONLY — cloud up but no internet, url:', cloudUrl);
    } else if (localResult.reachable && localResult.isOnline) {
      // Cloud down, local has internet
      newMode      = NetworkMode.FULL_ONLINE;
      newActiveUrl = localUrl;
      log.info('probe() DECISION: FULL_ONLINE via local URL (cloud down):', localUrl);
    } else if (localResult.reachable) {
      // Local up, no internet — Mode 2 via local server
      newMode      = NetworkMode.INTRANET_ONLY;
      newActiveUrl = localUrl;
      log.info('probe() DECISION: INTRANET_ONLY — local up but no internet, url:', localUrl);
    } else {
      // Nothing reachable — Mode 3
      newMode      = NetworkMode.DEEP_OFFLINE;
      newActiveUrl = '';
      log.warn('probe() DECISION: DEEP_OFFLINE — neither cloud nor local reachable');
    }

    // Log mode transitions explicitly
    if (prevModeRef.current !== null && prevModeRef.current !== newMode) {
      log.info(
        `probe() MODE TRANSITION: ${prevModeRef.current} → ${newMode}`,
        `| activeUrl: "${newActiveUrl || 'none'}"`,
      );
    }
    prevModeRef.current = newMode;

    setMode(newMode);
    setActiveUrl(newActiveUrl);

    log.info('probe() COMPLETE — mode:', newMode, '| activeUrl:', newActiveUrl || '(none)');
  }, []);

  useEffect(() => {
    log.info('useNetwork() MOUNT — starting connectivity monitor');

    // Device connectivity listener (for UI state only — probe does the real check)
    const unsubscribe = NetInfo.addEventListener((state) => {
      log.info('useNetwork() NetInfo change —',
        `type=${state.type}`,
        `isConnected=${state.isConnected}`,
        `isInternetReachable=${state.isInternetReachable}`,
        '→ triggering probe',
      );
      probe();
    });

    // Initial probe + recursive schedule
    let cancelled = false;

    const schedule = () => {
      timerRef.current = setTimeout(() => {
        if (!cancelled) {
          log.debug('useNetwork() scheduled poll firing');
          probe().then(schedule);
        }
      }, PROBE_INTERVAL_MS);
    };

    log.info('useNetwork() running initial probe …');
    probe().then(schedule);

    return () => {
      log.info('useNetwork() UNMOUNT — stopping connectivity monitor');
      cancelled = true;
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [probe]);

  // Convenience booleans for NetworkBanner (keeps its existing API unchanged)
  const serverReachable   = mode !== NetworkMode.DEEP_OFFLINE;
  const serverHasInternet = mode === NetworkMode.FULL_ONLINE;

  return {
    mode,
    activeUrl,
    cloudStatus,
    localStatus,
    serverReachable,
    serverHasInternet,
    probe,
  };
}