import React, { useState, useEffect } from 'react';
import { syncPendingActions } from '../api/api';
import { useToast } from '../hooks/useToast';
import './OfflineIndicator.css';

/**
 * Shows when the app is offline. When back online: re-verify session, then sync queued actions (backup).
 */
export default function OfflineIndicator({ onBackOnline }) {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const { showToast } = useToast();

  useEffect(() => {
    const handleOnline = async () => {
      setIsOnline(true);
      onBackOnline?.();
      try {
        const result = await syncPendingActions();
        if (result.synced > 0) {
          showToast(`Back online. Synced ${result.synced} saved action(s) to server.`, 'success');
        }
        if (result.failed > 0) {
          showToast(`${result.failed} action(s) could not sync. They stay in queue.`, 'error');
        }
      } catch (e) {
        console.warn('Sync on back online failed', e);
      }
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [onBackOnline, showToast]);

  if (isOnline) return null;
  return (
    <div className="offline-indicator" role="status" aria-live="polite">
      <span className="offline-dot" /> You're offline. Data will sync when connection is back.
    </div>
  );
}
