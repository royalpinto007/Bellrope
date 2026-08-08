import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_FAILURES,
  ago,
  backoffMinutes,
  dueNow,
  intervalLabel,
  isDue,
  nextDueAt,
} from '../src/schedule.js';
import type { Watch } from '../src/types.js';

const MINUTE = 60_000;
const NOW = 1_700_000_000_000;

function watch(over: Partial<Watch> = {}): Watch {
  return {
    id: 'w',
    url: 'https://example.com',
    label: 'A watch',
    selector: '#thing',
    text: 'before',
    intervalMinutes: 60,
    createdAt: NOW,
    lastCheckedAt: NOW,
    lastChangedAt: null,
    failures: 0,
    lastError: null,
    paused: false,
    history: [],
    ...over,
  };
}

test('a healthy watch waits exactly its interval', () => {
  assert.equal(backoffMinutes(60, 0), 60);
  assert.equal(nextDueAt(watch()), NOW + 60 * MINUTE);
});

test('failures double the wait, up to a day', () => {
  assert.equal(backoffMinutes(60, 1), 120);
  assert.equal(backoffMinutes(60, 3), 480);
  // A site that has been down for a week is asked once a day, not 96 times.
  assert.equal(backoffMinutes(60, 10), 1440);
  assert.equal(backoffMinutes(1440, 5), 1440);
});

test('a brand new watch is due immediately', () => {
  // Someone who just set one up should see it work, not wait an hour to
  // discover they picked the wrong element.
  assert.equal(nextDueAt(watch({ lastCheckedAt: null })), 0);
  assert.equal(isDue(watch({ lastCheckedAt: null }), NOW), true);
});

test('paused watches are never due', () => {
  assert.equal(isDue(watch({ paused: true, lastCheckedAt: null }), NOW), false);
  assert.equal(nextDueAt(watch({ paused: true })), Infinity);
});

test('a watch that has failed too often is left alone', () => {
  const dead = watch({ failures: MAX_FAILURES, lastCheckedAt: NOW - 999 * MINUTE });
  assert.equal(isDue(dead, NOW), false);
});

test('the oldest checks go first, and only a few per tick', () => {
  const old = watch({ id: 'old', lastCheckedAt: NOW - 500 * MINUTE });
  const older = watch({ id: 'older', lastCheckedAt: NOW - 900 * MINUTE });
  const recent = watch({ id: 'recent', lastCheckedAt: NOW - 100 * MINUTE });

  const due = dueNow([old, recent, older], NOW, 2);
  assert.deepEqual(
    due.map((w) => w.id),
    ['older', 'old']
  );
});

test('nothing due means nothing checked', () => {
  assert.deepEqual(dueNow([watch()], NOW), []);
});

test('intervals are named, not printed as numbers', () => {
  assert.equal(intervalLabel(60), 'Hourly');
  assert.equal(intervalLabel(1440), 'Daily');
  assert.equal(intervalLabel(7), 'Every 7 minutes');
});

test('relative times read the way people say them', () => {
  assert.equal(ago(null, NOW), 'not yet checked');
  assert.equal(ago(NOW - 20_000, NOW), 'just now');
  assert.equal(ago(NOW - 5 * MINUTE, NOW), '5 min ago');
  assert.equal(ago(NOW - 60 * MINUTE, NOW), '1 hour ago');
  assert.equal(ago(NOW - 5 * 60 * MINUTE, NOW), '5 hours ago');
  assert.equal(ago(NOW - 48 * 60 * MINUTE, NOW), '2 days ago');
  assert.equal(ago(NOW - 21 * 24 * 60 * MINUTE, NOW), '3 weeks ago');
});

test('a clock that has gone backwards does not print a negative age', () => {
  assert.equal(ago(NOW + 5000, NOW), 'just now');
});
