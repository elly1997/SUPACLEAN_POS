import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useBusinessDay } from '../contexts/BusinessDayContext';
import { formatBusinessDayLabel } from '../utils/businessDate';
import './WorkingDayPicker.css';

/**
 * Compact unreconciled-day selector (custom menu — native <select> was closing on refresh).
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

  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const options = useMemo(() => {
    const list = Array.isArray(workableDays) ? workableDays : [];
    if (!list.some((d) => d.date === today)) {
      return [{ date: today, is_today: true, has_summary: false }, ...list];
    }
    return list;
  }, [workableDays, today]);

  const priorCount = options.filter((d) => d.date !== today).length;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleOpen = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    // Refresh quietly while menu stays open (do not disable the trigger).
    refreshWorkableDays({ silent: true }).catch(() => {});
  };

  const choose = (ymd) => {
    setWorkingDate(ymd);
    setOpen(false);
  };

  return (
    <div
      ref={rootRef}
      className={`working-day-picker ${isCatchUpMode ? 'working-day-picker--catchup' : ''} ${className}`.trim()}
    >
      <span className="working-day-picker__label" id={`${id}-label`}>
        Working day
      </span>
      <div className="working-day-picker__control">
        <button
          type="button"
          id={id}
          className="working-day-picker__trigger"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-labelledby={`${id}-label`}
          onClick={toggleOpen}
        >
          <span className="working-day-picker__value">
            {workingDate === today ? 'Today' : 'Prior day'}
            <span className="working-day-picker__date">{formatBusinessDayLabel(workingDate)}</span>
          </span>
          <span className="working-day-picker__chevron" aria-hidden>
            ▾
          </span>
        </button>

        {open && (
          <div className="working-day-picker__menu" role="listbox" aria-labelledby={`${id}-label`}>
            <div className="working-day-picker__menu-head">
              Unreconciled days{priorCount ? ` (${priorCount})` : ''}
              {loadingWorkable ? <span className="working-day-picker__loading"> · refreshing…</span> : null}
            </div>
            <ul className="working-day-picker__list">
              {options.map((d) => {
                const selected = d.date === workingDate;
                return (
                  <li key={d.date}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`working-day-picker__option ${selected ? 'is-selected' : ''}`}
                      onClick={() => choose(d.date)}
                    >
                      <span className="working-day-picker__option-main">
                        {d.is_today || d.date === today ? 'Today' : formatBusinessDayLabel(d.date)}
                      </span>
                      <span className="working-day-picker__option-meta">
                        {d.date === today
                          ? formatBusinessDayLabel(d.date)
                          : d.has_summary
                            ? 'Unreconciled'
                            : 'Open'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {!loadingWorkable && priorCount === 0 && (
              <p className="working-day-picker__empty">No prior unreconciled days for this branch.</p>
            )}
          </div>
        )}
      </div>
      {isCatchUpMode && (
        <button type="button" className="working-day-picker__reset" onClick={clearWorkingDate}>
          Today
        </button>
      )}
    </div>
  );
}
