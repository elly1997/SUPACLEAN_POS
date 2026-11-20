import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getWorkableBusinessDays } from '../api/api';
import { getBusinessTodayYmd } from '../utils/businessDate';
import { useAuth } from './AuthContext';

const STORAGE_KEY = 'supaclean_working_business_day';

const BusinessDayContext = createContext(null);

function readStoredWorkingDate() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  } catch {
    /* ignore */
  }
  return null;
}

export function BusinessDayProvider({ children }) {
  const { selectedBranchId, user, hasPermission } = useAuth();
  const today = getBusinessTodayYmd();
  const [workingDate, setWorkingDateState] = useState(() => readStoredWorkingDate() || today);
  const [workableDays, setWorkableDays] = useState([]);
  const [loadingWorkable, setLoadingWorkable] = useState(false);
  const canLoadWorkable = hasPermission?.('canManageCash') || hasPermission?.('canCreateOrders');

  const persist = useCallback((ymd) => {
    try {
      if (!ymd || ymd === today) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, ymd);
    } catch {
      /* ignore */
    }
  }, [today]);

  const setWorkingDate = useCallback(
    (ymd) => {
      const next = ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : today;
      setWorkingDateState(next);
      persist(next);
    },
    [persist, today]
  );

  const clearWorkingDate = useCallback(() => {
    setWorkingDate(today);
  }, [setWorkingDate, today]);

  const refreshWorkableDays = useCallback(async (opts = {}) => {
    const silent = opts.silent === true;
    if (!canLoadWorkable) {
      setWorkableDays([{ date: today, is_today: true, has_summary: false, is_reconciled: false }]);
      return [];
    }
    if (!silent) setLoadingWorkable(true);
    try {
      const res = await getWorkableBusinessDays({ lookback: 60 });
      const days = Array.isArray(res.data?.days) ? res.data.days : [];
      setWorkableDays(days);
      return days;
    } catch (err) {
      console.warn('workable-days load failed', err?.response?.data?.error || err?.message || err);
      setWorkableDays([{ date: today, is_today: true, has_summary: false, is_reconciled: false }]);
      return [];
    } finally {
      if (!silent) setLoadingWorkable(false);
    }
  }, [canLoadWorkable, today]);

  useEffect(() => {
    // Branch switch: reset to today so we never post another branch's catch-up day.
    setWorkingDateState(today);
    persist(today);
    refreshWorkableDays();
  }, [selectedBranchId, user?.branchId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (workingDate > today) {
      setWorkingDate(today);
      return;
    }
    if (!workableDays.length) return;
    const stillOpen = workableDays.some((d) => d.date === workingDate);
    if (!stillOpen && workingDate !== today) {
      setWorkingDate(today);
    }
  }, [workableDays, workingDate, today, setWorkingDate]);

  const isCatchUpMode = workingDate !== today;

  const value = useMemo(
    () => ({
      today,
      workingDate,
      setWorkingDate,
      clearWorkingDate,
      isCatchUpMode,
      workableDays,
      loadingWorkable,
      refreshWorkableDays,
    }),
    [
      today,
      workingDate,
      setWorkingDate,
      clearWorkingDate,
      isCatchUpMode,
      workableDays,
      loadingWorkable,
      refreshWorkableDays,
    ]
  );

  return <BusinessDayContext.Provider value={value}>{children}</BusinessDayContext.Provider>;
}

export function useBusinessDay() {
  const ctx = useContext(BusinessDayContext);
  if (!ctx) {
    const today = getBusinessTodayYmd();
    return {
      today,
      workingDate: today,
      setWorkingDate: () => {},
      clearWorkingDate: () => {},
      isCatchUpMode: false,
      workableDays: [],
      loadingWorkable: false,
      refreshWorkableDays: async () => [],
    };
  }
  return ctx;
}
