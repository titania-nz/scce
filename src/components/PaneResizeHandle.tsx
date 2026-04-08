'use client';

import type { PointerEvent as ReactPointerEvent } from 'react';

interface PaneResizeHandleProps {
  ariaLabel: string;
  dataTestId: string;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDoubleClick: () => void;
  className?: string;
}

export default function PaneResizeHandle({
  ariaLabel,
  dataTestId,
  onPointerDown,
  onDoubleClick,
  className = '',
}: PaneResizeHandleProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      role="separator"
      aria-orientation="vertical"
      data-testid={dataTestId}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      className={`pane-resize-handle shrink-0 ${className}`.trim()}
    >
      <span className="pane-resize-handle__line" />
    </button>
  );
}
