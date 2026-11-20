import React, { useMemo } from 'react';
import { useBusinessDay } from '../contexts/BusinessDayContext';
import { formatBusinessDayLabel } from '../utils/businessDate';
import './WorkingDayPicker.css';

/**
 * Compact unreconciled-day selector for New Order / Cash Management.
 */
export default function WorkingDayPicker({ id = 'working-day-picker', className = '' }) {
  const {
    workingDate,
    setWorkingDate,
    clearWorkingDate,
    isCatchUpMode,
    workableDays,
    loadingWorkable,
    refreshWorkableDays,
    today,
  } = useBusinessDay();

  const priorDays = useMemo(
    () => (workableDays || []).filter((d) => d.date !== today),
    [workableDays, today]
  );

  return (
    <div className={`working-day-picker ${isCatchUpMode ? 'working-day-picker--catchup' : ''} ${className}`.trim()}>
      <label htmlFor={id} className="working-day-picker__label">
        Working day
      </label>
      <select
        id={id}
        className="working-day-picker__select"
        value={workingDate}
        disabled={loadingWorkable}
        onChange={(e) => setWorkingDate(e.target.value)}
        onFocus={() => refreshWorkableDays()}
        title="Post orders / cash activity on today or an unreconciled prior day"
      >
        <option value={today}>Today — {formatBusinessDayLabel(today)}</option>
        {priorDays.map((d) => (
          <option key={d.date} value={d.date}>
            {formatBusinessDayLabel(d.date)}
            {d.has_summary ? '' : ' · open'}
          </option>
        ))}
      </select>
      {isCatchUpMode && (
        <button type="button" className="working-day-picker__reset" onClick={clearWorkingDate}>
          Today
        </button>
      )}
    </div>
  );
}
