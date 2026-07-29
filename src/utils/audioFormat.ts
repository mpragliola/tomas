/** Format a duration in milliseconds as "X.Xs". */
export function formatDurationMs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Format a duration in seconds as "M:SS.S". */
export function formatTimeSecs(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  return `${mins}:${Number(secs) < 10 ? '0' : ''}${secs}`;
}
