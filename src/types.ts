/** How often a watch is checked. Minutes, because alarms are minute-grained. */
export type Interval = 15 | 60 | 360 | 1440;

export interface Change {
  /** Milliseconds since the epoch. */
  at: number;
  /** What the watched text said before. */
  before: string;
  /** What it says now. */
  after: string;
  /** A one-line description, already worded for a person. */
  summary: string;
}

export interface Watch {
  id: string;
  /** The page being watched, normalised. */
  url: string;
  /** What the user called it, or a name derived from the page. */
  label: string;
  /** How the watched element is found again in a freshly fetched page. */
  selector: string;
  /** The text as of the last successful check. */
  text: string;
  intervalMinutes: Interval;
  createdAt: number;
  lastCheckedAt: number | null;
  lastChangedAt: number | null;
  /**
   * Consecutive failed checks.
   *
   * Drives the backoff, and is reset by any success. A site that is briefly
   * down should not cost the user their watch, and a site that is permanently
   * gone should not be hammered every fifteen minutes forever.
   */
  failures: number;
  /** Why the last check failed, in words, or null if the last check worked. */
  lastError: string | null;
  paused: boolean;
  /** Most recent first, capped. */
  history: Change[];
}

/** What a single check produced. */
export type CheckResult =
  { ok: true; text: string } | { ok: false; error: string; permanent: boolean };
