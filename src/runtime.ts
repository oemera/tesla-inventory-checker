export function pollInterval(value: string | undefined): number {
  const seconds = Number(value ?? "60");
  if (!Number.isInteger(seconds) || seconds < 60) throw new Error("POLL_INTERVAL_SECONDS must be at least 60.");
  return seconds;
}

export function nextDelay(interval: number, failures: number, retryAfter = 0, jitter = Math.floor(Math.random() * 11)): number {
  return Math.max(interval, retryAfter, failures ? Math.min(3600, interval * 2 ** Math.min(failures, 6)) : 0) + jitter;
}
