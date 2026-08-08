# Contributing to Bellrope

Bellrope is a Chrome MV3 extension written in TypeScript with no runtime
dependencies. It watches a part of a page and tells you when it changes,
entirely from your own browser.

## Local setup

```bash
npm ci
npm run build
```

Then open `chrome://extensions`, enable Developer mode, choose Load unpacked
and select the repository root.

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run format:check
npm run build
npm run test:e2e   # needs: npx playwright install chromium
```

Run the end-to-end suite. Most of what can go wrong here only exists in a
browser: the offscreen parser, the fetch, the picker inside a page, and the
notification.

## Four rules

**Bellrope has no server of its own.** No analytics, no telemetry, no remote
config, no CDN fonts, no "anonymous" usage ping. CI greps the built bundles for
any hardcoded URL and fails if one appears. Every request must go to a page the
user chose.

**Nothing checks more often than the user asked.** A change here is not paid by
us, it is paid by the sites being watched. Anything that increases how often or
how widely Bellrope fetches needs a reason in the pull request.

**A failed check must never lose the last known text.** If it did, the next
success would report a change that never happened, and the user would act on
it. `applyCheck` is total and pure for exactly this reason.

**Never claim a watch is working when it cannot be.** A watch on a page that
renders in the browser can only ever report "not found". It is refused at
creation, with the reason, rather than accepted and left to fail quietly.

## Guidelines

- Keep the change focused. One concern per pull request.
- Match the surrounding code: same naming, same file layout, same idiom.
- Logic that can be pure should be pure and should come with tests. Selector
  building, diffing, scheduling, encoding and the watch state machine all live
  in `src/` so they can be tested without a browser or a clock.
- Watched text comes from arbitrary pages, so it is never interpolated into
  markup. Build nodes and set `textContent`. There is no `innerHTML` in this
  codebase and there should not be one.
- Summaries are sentences with the numbers in them, and they never overstate.
  If a change cannot be described honestly in one line, say what it was and
  what it is now rather than inventing a tidier story.
- If you add a permission to the manifest, say in the pull request why it is
  needed and whether it could be optional instead.
- Update the README and CHANGELOG in the same pull request when behaviour
  changes.

## Adding a rule to the summariser

`describeChange` is ordered by how much each form tells the reader. If you add
a case, it goes where it belongs in that order, and it needs a test proving it
does not fire on input it cannot describe honestly. The existing "two numbers
moved at once" case is the pattern: it deliberately declines rather than
picking one.

## Reporting bugs

Use the bug report template. A public URL is worth more than any description,
because what the server sends is usually the whole explanation.
