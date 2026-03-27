import { useRef } from 'react';

export default function useHorizontalScrollRegion() {
  const dragStateRef = useRef({
    active: false,
    dragged: false,
    startX: 0,
    startLeft: 0,
    pointerId: null
  });
  const DRAG_THRESHOLD_PX = 6;

  const isInteractiveTarget = (target) => {
    if (!target || typeof target.closest !== 'function') return false;
    return !!target.closest(
      'button,a,input,select,textarea,label,[role="button"],[data-no-drag-scroll="true"]'
    );
  };

  const onWheel = (e) => {
    const el = e.currentTarget;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };

  const onPointerDown = (e) => {
    if (isInteractiveTarget(e.target)) return;
    if (e.button != null && e.button !== 0) return;
    const el = e.currentTarget;
    dragStateRef.current = {
      active: true,
      dragged: false,
      startX: e.clientX,
      startLeft: el.scrollLeft,
      pointerId: e.pointerId
    };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const el = e.currentTarget;
    const s = dragStateRef.current;
    if (!s.active) return;
    const dx = e.clientX - s.startX;
    if (!s.dragged && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    if (!s.dragged) {
      s.dragged = true;
      el.classList.add('is-dragging');
    }
    el.scrollLeft = s.startLeft - dx;
    e.preventDefault();
  };

  const endDrag = (e) => {
    const el = e.currentTarget;
    const s = dragStateRef.current;
    if (s.pointerId != null && el.hasPointerCapture?.(s.pointerId)) {
      el.releasePointerCapture(s.pointerId);
    }
    dragStateRef.current = { active: false, dragged: false, startX: 0, startLeft: 0, pointerId: null };
    el.classList.remove('is-dragging');
  };

  const onPointerUp = (e) => endDrag(e);
  const onPointerCancel = (e) => endDrag(e);
  const onPointerLeave = (e) => {
    // Mouse leaving while dragging should end visual drag state.
    if (dragStateRef.current.active) endDrag(e);
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

  return { onWheel, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onPointerLeave, onKeyDown };
}

