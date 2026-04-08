export interface PaneBounds {
  min: number;
  max: number;
}

export function clampPaneWidth(value: number, bounds: PaneBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

export function sanitizeStoredPaneWidth(
  value: unknown,
  fallback: number,
  bounds: PaneBounds,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return clampPaneWidth(value, bounds);
}

export function sanitizeStoredSplitRatio(
  value: unknown,
  fallback: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(0.8, Math.max(0.2, value));
}

export function clampSplitRatio(
  ratio: number,
  containerWidth: number,
  minPaneWidth: number,
): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= minPaneWidth * 2) {
    return 0.5;
  }

  const minRatio = minPaneWidth / containerWidth;
  const maxRatio = 1 - minRatio;
  return Math.min(maxRatio, Math.max(minRatio, ratio));
}

export function getPersistablePaneWidth(
  isOpen: boolean,
  width: number,
  bounds: PaneBounds,
): number | null {
  if (!isOpen) {
    return null;
  }

  return clampPaneWidth(width, bounds);
}
