import React from 'react';
import './ListViewToggle.css';

/**
 * Toggle between Table and Card list view. Uses useListViewPreference (persisted).
 */
function ListViewToggle({ view, setView, className = '' }) {
  return (
    <div className={`list-view-toggle ${className}`} role="group" aria-label="List view">
      <button
        type="button"
        className={`toggle-btn ${view === 'table' ? 'active' : ''}`}
        onClick={() => setView('table')}
        aria-pressed={view === 'table'}
        title="Table view — best for large lists"
      >
        📋 Table
      </button>
      <button
        type="button"
        className={`toggle-btn ${view === 'card' ? 'active' : ''}`}
        onClick={() => setView('card')}
        aria-pressed={view === 'card'}
        title="Card view"
      >
        🃏 Card
      </button>
    </div>
  );
}

export default ListViewToggle;
