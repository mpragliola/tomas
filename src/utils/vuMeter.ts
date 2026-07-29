const ARC_CENTER_X = 60;
const ARC_CENTER_Y = 60;
const ARC_RADIUS = 45;
const DB_MIN = -60;
const DB_MAX = 0;

function normalizeDb(level: number): number {
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, level));
  return (clamped - DB_MIN) / (DB_MAX - DB_MIN);
}

/** SVG path for the arc fill up to `level` dB. */
export function getArcPath(level: number): string {
  const angle = Math.PI * normalizeDb(level);
  const x = ARC_CENTER_X - ARC_RADIUS * Math.cos(angle);
  const y = ARC_CENTER_Y - ARC_RADIUS * Math.sin(angle);
  return `M 15,60 A ${ARC_RADIUS},${ARC_RADIUS} 0 0,1 ${x},${y}`;
}

/** SVG coordinates for the threshold notch tick (r=41 to r=49, centered on r=45). */
export function getThresholdNotch(thresholdDb: number): { x1: number; y1: number; x2: number; y2: number } {
  const angle = Math.PI * normalizeDb(thresholdDb);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x1: ARC_CENTER_X - 41 * cos,
    y1: ARC_CENTER_Y - 41 * sin,
    x2: ARC_CENTER_X - 49 * cos,
    y2: ARC_CENTER_Y - 49 * sin,
  };
}

/**
 * Convert a pointer event over the arc SVG into a dB value.
 * Returns null if the pointer is outside the valid arc region.
 * Assumes the SVG viewBox is "0 0 120 70".
 */
export function arcDbFromPointer(event: PointerEvent): number | null {
  const svg = event.currentTarget as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const svgX = ((event.clientX - rect.left) / rect.width) * 120;
  const svgY = ((event.clientY - rect.top) / rect.height) * 70;
  const angle = Math.atan2(ARC_CENTER_Y - svgY, svgX - ARC_CENTER_X);
  if (angle < 0 || angle > Math.PI) return null;
  const normalized = (Math.PI - angle) / Math.PI;
  return Math.round(normalized * (DB_MAX - DB_MIN) + DB_MIN);
}
