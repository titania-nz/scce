'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface PointerDragPosition {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  deltaX: number;
  deltaY: number;
}

interface PointerDragHandlers<T> {
  onDragStart?: (meta: T, position: PointerDragPosition) => void;
  onDragMove: (meta: T, position: PointerDragPosition) => void;
  onDragEnd?: (meta: T, position: PointerDragPosition) => void;
}

export function usePointerDrag<T>({
  onDragStart,
  onDragMove,
  onDragEnd,
}: PointerDragHandlers<T>) {
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  return useCallback((event: ReactPointerEvent<HTMLElement>, meta: T) => {
    if (event.button !== 0) return;

    cleanupRef.current?.();

    event.preventDefault();

    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;

    target.setPointerCapture?.(pointerId);
    document.body.classList.add('pane-resize-active');

    const toPosition = (nextEvent: PointerEvent): PointerDragPosition => ({
      startX,
      startY,
      currentX: nextEvent.clientX,
      currentY: nextEvent.clientY,
      deltaX: nextEvent.clientX - startX,
      deltaY: nextEvent.clientY - startY,
    });

    onDragStart?.(meta, toPosition(event.nativeEvent));

    const handlePointerMove = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId !== pointerId) return;
      nextEvent.preventDefault();
      onDragMove(meta, toPosition(nextEvent));
    };

    const handlePointerEnd = (nextEvent: PointerEvent) => {
      if (nextEvent.pointerId !== pointerId) return;

      document.body.classList.remove('pane-resize-active');
      target.releasePointerCapture?.(pointerId);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      cleanupRef.current = null;
      onDragEnd?.(meta, toPosition(nextEvent));
    };

    cleanupRef.current = () => {
      document.body.classList.remove('pane-resize-active');
      target.releasePointerCapture?.(pointerId);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerEnd);
      window.removeEventListener('pointercancel', handlePointerEnd);
      cleanupRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
  }, [onDragEnd, onDragMove, onDragStart]);
}
