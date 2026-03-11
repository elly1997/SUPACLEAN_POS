import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'app_list_view'; // 'table' | 'card'
const DEFAULT_VIEW = 'table';

/**
 * Persisted list view preference (table vs card). Shared across Dashboard, Orders, Collection, Customers.
 * @returns {['table'|'card', (v: 'table'|'card') => void]}
 */
export function useListViewPreference() {
  const [view, setViewState] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'table' || stored === 'card') return stored;
    } catch (e) {}
    return DEFAULT_VIEW;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, view);
    } catch (e) {}
  }, [view]);

  const setView = useCallback((v) => {
    setViewState((prev) => (v === 'card' || v === 'table' ? v : prev));
  }, []);

  return [view, setView];
}
