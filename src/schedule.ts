import type { Watch } from './types.js';

/**
 * When each watch is next checked.
 *
 * All pure, because the alternative is discovering the backoff is wrong by
 * watching a dead site get hit every fifteen minutes for a week.
 */

/** The alarm ticks this often; each tick checks whatever has come due. */
export const TICK_MINUTES = 5;

/** Give up on a watch after this many consecutive failures. */
export const MAX_FAILURES = 8;

/**
 * How long to wait after a failure, in minutes.
 *
 * Doubling from the watch's own interval, capped at a day. A site that is down
 * for an hour costs the user nothing; a site that has been 404 since Tuesday
 * gets asked once a day rather than ninety-six times.
 */
export function backoffMinutes(intervalMinutes: number, failures: number): number {
  if (failures <= 0) return intervalMinutes;
  return Math.min(intervalMinutes * 2 ** failures, 1440);
}

/**
 * When this watch is next due.
 *
 * A watch that has never been checked is due immediately: someone who has just
 * set one up should see it work, not wait an hour to find out they picked the
 * wrong element.
 */
export function nextDueAt(watch: Watch): number {
  if (watch.paused) return Infinity;
  if (watch.lastCheckedAt === null) return 0;
  const wait = backoffMinutes(watch.intervalMinutes, watch.failures);
  return watch.lastCheckedAt + wait * 60_000;
}

export function isDue(watch: Watch, now: number): boolean {
  if (watch.paused) return false;
  if (watch.failures >= MAX_FAILURES) return false;
  return nextDueAt(watch) <= now;
}

/**
 * The watches to check on this tick, oldest first, capped.
 *
 * The cap matters: twenty watches coming due together would fire twenty
 * simultaneous fetches from a service worker that Chrome may evict mid-flight.
 * The rest are picked up on the next tick, minutes later.
 */
export function dueNow(watches: readonly Watch[], now: number, limit = 5): Watch[] {
  return watches
    .filter((w) => isDue(w, now))
    .sort((a, b) => (a.lastCheckedAt ?? 0) - (b.lastCheckedAt ?? 0))
    .slice(0, limit);
}

const LABELS: Record<number, string> = {
  15: 'Every 15 minutes',
  60: 'Hourly',
  360: 'Every 6 hours',
  1440: 'Daily',
};

export function intervalLabel(minutes: number): string {
  return LABELS[minutes] ?? `Every ${minutes} minutes`;
}

/** A relative time, for a list that is read at a glance. */
export function ago(then: number | null, now: number): string {
  if (then === null) return 'not yet checked';

  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;

  const weeks = Math.round(days / 7);
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
}
