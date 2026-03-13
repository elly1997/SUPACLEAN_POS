import React, { useState, useEffect } from 'react';
import './Loader.css';

/**
 * Full-page or inline loader. Uses a short animation cycle (1.2s) for quicker perceived response.
 * Optional: only show after a short delay so fast responses don't flash the loader.
 * @param {string} [message] - Text below the loader (e.g. "Loading dashboard...")
 * @param {boolean} [fullPage] - If true, use min-height 60vh for full-page loading
 * @param {number} [delayMs=150] - Only show loader after this many ms (reduces flash on fast responses)
 */
function Loader({ message = 'Loading…', fullPage = true, delayMs = 150 }) {
  const [show, setShow] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) {
      setShow(true);
      return;
    }
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  if (!show) return null;

  return (
    <div
      className={`loader-wrap ${fullPage ? 'full-page' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      <div className="loader">
        <span className="loader-text">Loading</span>
        <span className="load" aria-hidden="true" />
      </div>
      {message && <p className="loader-message">{message}</p>}
    </div>
  );
}

export default Loader;
