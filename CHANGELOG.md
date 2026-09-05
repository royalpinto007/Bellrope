# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-09-06

### Added

- Redesigned side panel: watch count with a news highlight, gradient watch
  button with a busy spinner, and search with a clear button.
- All, News, Failing and Paused filter tabs for the watch list.
- Avatar and status dot cards, timeline-style change history, emphasised
  detail cards, and toast notifications.

## [1.0.0] - 2026-08-08

First release.

### Added

- Pick any element on a page and watch it. The picker outlines what is under
  the cursor and suppresses the click, so choosing a button does not press it.
- Checks every 15 minutes, hourly, every 6 hours or daily, driven by a single
  alarm and run in the background.
- Notifications that say what changed, not that something did. A single number
  moving is reported as a delta: "£39 is now £29, down £10".
- Selectors built to survive a redesign, ignoring framework-generated ids and
  utility classes.
- Pages that render in the browser are refused at creation, with the reason,
  rather than accepted and left to report nothing forever.
- Failure backoff that doubles after each failed check, up to a day, and stops
  entirely on a 404.
- History of the last 20 changes per watch, with pause, resume, check now and
  remove.

### Notes

- No server, no account, no analytics. Every request goes to a page you chose,
  without cookies.
- No content scripts and no standing host permissions: page access is asked for
  when the first watch is created.

[1.0.0]: https://github.com/royalpinto007/Bellrope/releases/tag/v1.0.0
