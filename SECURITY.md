# Security Policy

## Supported versions

The latest release is supported. Bellrope is a browser extension, so the
version that matters is the one installed from the store.

## Reporting a vulnerability

Please do not open a public issue, discussion or pull request for a security
problem.

Report it privately through GitHub's
[security advisory form](https://github.com/royalpinto007/Bellrope/security/advisories/new),
which is visible only to the maintainers.

Include what you found, how to reproduce it, and what an attacker could do with
it. A rough proof of concept helps.

You can expect an acknowledgement within a week. If the report is valid, we
will agree a disclosure timeline with you before anything is made public.

## Scope

Bellrope fetches pages the user chose and compares their text. The things most
worth reporting:

- **Anything that gets script execution in the extension's context.** Fetched
  HTML is entirely attacker-controlled and is parsed on every check. It is
  parsed with `DOMParser`, which executes nothing and loads nothing, and the
  text is rendered with `textContent`. A way around either is the highest
  severity issue here.
- **Anything that makes Bellrope fetch a URL the user did not choose.** A
  redirect chain is followed, so a page that can steer that chain is worth
  looking at.
- **Anything that sends a request anywhere other than a watched page.** There
  should be no such request at all, so one appearing is a finding in itself.
- **Anything that causes a request to carry credentials.** Fetches are made
  with `credentials: 'omit'` on purpose, so a watch never reads a signed-in
  view and never stores one.
- **Anything in the picker that lets a page act on the user's behalf.** The
  picking click is suppressed in the capture phase precisely so that choosing a
  "Buy now" button does not press it.

Out of scope: a watch missing a change, or reporting one that did not matter.
Those are bugs, and the bug template is the right place for them.
