import { useEffect, useRef } from 'react';

/**
 * Custom React hook for real-time data polling with tab-visibility awareness.
 * 
 * - Polls automatically every `intervalMs` (default: 5000ms).
 * - Pauses polling when the browser tab is hidden/inactive.
 * - Immediately refetches when user returns to the tab, then resumes interval.
 * - Prevents duplicate/overlapping in-flight requests.
 * 
 * @param {Function} callback - Async or synchronous function to fetch updated data.
 * @param {number} intervalMs - Polling interval in milliseconds (default: 5000ms).
 * @param {Array} dependencies - Additional dependencies that should re-trigger polling.
 */
export function useAutoRefresh(callback, intervalMs = 5000, dependencies = []) {
  const savedCallback = useRef(callback);
  const inFlightRef = useRef(false);
  const lastRunRef = useRef(0);

  // Keep latest callback reference
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    let timerId = null;
    let wakeTimeout = null;
    let isMounted = true;
    const focusCooldownMs = Math.min(Math.max(intervalMs, 15000), 30000);

    const executeCallback = async (respectCooldown = false) => {
      if (!isMounted || inFlightRef.current) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (respectCooldown && (Date.now() - lastRunRef.current) < focusCooldownMs) return;
      inFlightRef.current = true;
      lastRunRef.current = Date.now();
      try {
        await savedCallback.current();
      } catch (err) {
        // Silently skip if network was suspended/aborted
        if (
          err?.message?.includes('NETWORK_IO_SUSPENDED') ||
          err?.message?.includes('Failed to fetch') ||
          err?.name === 'AbortError'
        ) {
          return;
        }
        console.warn('[useAutoRefresh]: Refetch failed:', err);
      } finally {
        if (isMounted) {
          inFlightRef.current = false;
        }
      }
    };

    const startTimer = () => {
      if (timerId) clearInterval(timerId);
      timerId = setInterval(() => {
        if (typeof document !== 'undefined' && !document.hidden && typeof navigator !== 'undefined' && navigator.onLine) {
          executeCallback(false);
        }
      }, intervalMs);
    };

    // Execute immediately on mount/dependency change if tab is active and online
    if (typeof document !== 'undefined' && !document.hidden && typeof navigator !== 'undefined' && navigator.onLine) {
      executeCallback(false);
    }

    startTimer();

    // Unified Tab visibility, Window focus & Online listeners with cooldown
    const scheduleWakeRefresh = () => {
      if (wakeTimeout) clearTimeout(wakeTimeout);
      if (typeof document !== 'undefined' && !document.hidden) {
        wakeTimeout = setTimeout(() => {
          if (isMounted && typeof navigator !== 'undefined' && navigator.onLine) {
            executeCallback(true);
            startTimer();
          }
        }, 300);
      } else {
        if (timerId) clearInterval(timerId);
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', scheduleWakeRefresh);
      window.addEventListener('focus', scheduleWakeRefresh);
      window.addEventListener('online', scheduleWakeRefresh);
    }

    return () => {
      isMounted = false;
      if (timerId) clearInterval(timerId);
      if (wakeTimeout) clearTimeout(wakeTimeout);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', scheduleWakeRefresh);
        window.removeEventListener('focus', scheduleWakeRefresh);
        window.removeEventListener('online', scheduleWakeRefresh);
      }
    };
  }, [intervalMs, ...dependencies]);
}

export default useAutoRefresh;
