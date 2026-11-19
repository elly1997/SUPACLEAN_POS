import { useCallback, useEffect, useRef } from 'react';

/**
 * Hover/focus chooses which nested panel receives wheel scrolling.
 * Pair with `.scroll-panel` CSS (hidden scrollbars until active).
 *
 * Usage:
 *   const panel = useScrollPanel({ axis: 'y' });
 *   <div className="scroll-panel scroll-panel--y" tabIndex={0} {...panel}>...</div>
 */
export default function useScrollPanel(options = {}) {
  const { axis = 'y' } = options;
  const elRef = useRef(null);
  const activeRef = useRef(false);

  const setActive = useCallback((el, on) => {
    activeRef.current = on;
    if (!el) return;
    el.classList.toggle('is-scroll-active', on);
    if (on) el.setAttribute('data-scroll-active', 'true');
    else el.removeAttribute('data-scroll-active');
  }, []);

  const ref = useCallback((node) => {
    elRef.current = node;
  }, []);

  const onMouseEnter = useCallback((e) => {
    setActive(e.currentTarget, true);
  }, [setActive]);

  const onMouseLeave = useCallback((e) => {
    setActive(e.currentTarget, false);
  }, [setActive]);

  const onFocus = useCallback((e) => {
    setActive(e.currentTarget, true);
  }, [setActive]);

  const onBlur = useCallback((e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setActive(e.currentTarget, false);
  }, [setActive]);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;

    const onWheel = (e) => {
      // Only own the wheel while hovered/focused (cursor selects the panel)
      if (!activeRef.current && !el.matches(':hover, :focus-within')) return;

      const canY = axis === 'y' || axis === 'both';
      const canX = axis === 'x' || axis === 'both';
      const dy = e.deltaY;
      const dx = e.deltaX;

      if (canY && Math.abs(dy) >= Math.abs(dx)) {
        const max = el.scrollHeight - el.clientHeight;
        if (max <= 0) return;
        const atTop = el.scrollTop <= 0;
        const atBottom = el.scrollTop >= max - 1;
        if ((dy < 0 && !atTop) || (dy > 0 && !atBottom)) {
          el.scrollTop += dy;
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      if (canX && (Math.abs(dx) > 0 || Math.abs(dy) > 0)) {
        const delta = Math.abs(dx) > 0 ? dx : dy;
        const max = el.scrollWidth - el.clientWidth;
        if (max <= 0) return;
        const atLeft = el.scrollLeft <= 0;
        const atRight = el.scrollLeft >= max - 1;
        if ((delta < 0 && !atLeft) || (delta > 0 && !atRight)) {
          el.scrollLeft += delta;
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  return {
    ref,
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
  };
}
