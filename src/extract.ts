import { normalise } from './diff.js';

/**
 * Reading the watched text back out of a fetched page.
 *
 * Takes a Document so the same code runs in the offscreen parser and in the
 * tests, and so a selector can be tried against a saved page without a
 * browser anywhere in sight.
 */

/**
 * The visible text of an element.
 *
 * Script and style contents are stripped, because textContent happily includes
 * an entire inline JSON blob and a watch on a product name would then fire
 * every time the analytics payload changed.
 */
export function visibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element;
  for (const junk of clone.querySelectorAll('script, style, template, noscript')) junk.remove();
  return normalise(clone.textContent ?? '');
}

export type Extraction =
  { found: true; text: string } | { found: false; reason: 'no-match' | 'empty' };

export function extract(doc: Document, selector: string): Extraction {
  let el: Element | null = null;
  try {
    el = doc.querySelector(selector);
  } catch {
    return { found: false, reason: 'no-match' };
  }
  if (!el) return { found: false, reason: 'no-match' };

  const text = visibleText(el);
  return text ? { found: true, text } : { found: false, reason: 'empty' };
}

/**
 * Whether a watch on this element can work at all.
 *
 * Checks are made against the HTML the server sends. A page that builds itself
 * in the browser sends a near-empty shell, so the element the user just
 * clicked is not in it and never will be. That has to be said at the moment
 * the watch is created: a watch that can only ever report "not found" is worse
 * than a refusal, because the user thinks it is working.
 */
export type Feasibility = { canWatch: true } | { canWatch: false; reason: string };

export function checkFeasible(served: Document, selector: string, seenText: string): Feasibility {
  const found = extract(served, selector);
  if (found.found) {
    // The element is there. The text differing slightly is fine and expected:
    // that is exactly the change this is here to notice.
    return { canWatch: true };
  }

  // If the text is somewhere in the served HTML but the selector missed it,
  // the page is fine and the selector is the problem, which is a different
  // conversation and a fixable one.
  const body = normalise(served.body?.textContent ?? '');
  const wanted = normalise(seenText);
  if (wanted && body.includes(wanted)) {
    return {
      canWatch: false,
      reason:
        'The text is on the page but this element could not be found again. Try selecting the text itself rather than the box around it.',
    };
  }

  if (body.length < 200) {
    return {
      canWatch: false,
      reason:
        'This page builds itself in your browser, so there is nothing to check without opening it. Bellrope cannot watch it.',
    };
  }

  return {
    canWatch: false,
    reason:
      'This part of the page is not in what the server sends, so it cannot be checked in the background.',
  };
}
