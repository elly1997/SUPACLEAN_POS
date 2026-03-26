import { useRef } from 'react';

export default function useHorizontalScrollRegion() {
  const dragStateRef = useRef({ active: false, startX: 0, startLeft: 0, pointerId: null });

  const onWheel = (e) => {
    const el = e.currentTarget;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };

  const onPointerDown = (e) => {
    const el = e.currentTarget;
    dragStateRef.current = {
      active: true,
      startX: e.clientX,
      startLeft: el.scrollLeft,
      pointerId: e.pointerId
    };
    el.classList.add('is-dragging');
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const el = e.currentTarget;
    const s = dragStateRef.current;
    if (!s.active) return;
    el.scrollLeft = s.startLeft - (e.clientX - s.startX);
  };

  const onPointerUp = (e) => {
    const el = e.currentTarget;
    const s = dragStateRef.current;
    if (s.pointerId != null && el.hasPointerCapture?.(s.pointerId)) {
      el.releasePointerCapture(s.pointerId);
    }
    dragStateRef.current = { active: false, startX: 0, startLeft: 0, pointerId: null };
    el.classList.remove('is-dragging');
  };

  const onKeyDown = (e) => {
    const el = e.currentTarget;
    if (e.key === 'ArrowRight') {
      el.scrollBy({ left: 120, behavior: 'smooth' });
      e.preventDefault();
    } else if (e.key === 'ArrowLeft') {
      el.scrollBy({ left: -120, behavior: 'smooth' });
      e.preventDefault();
    }
  };

  return { onWheel, onPointerDown, onPointerMove, onPointerUp, onKeyDown };
}

