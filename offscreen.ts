import { checkFeasible, extract } from './src/extract.js';

/**
 * Parses fetched HTML.
 *
 * A service worker has no DOMParser, so the fetched page is passed here to be
 * turned into a Document and queried. This document loads nothing and runs
 * nothing from the page: DOMParser does not execute scripts or fetch
 * subresources, which is the reason to parse here rather than in a tab.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'PARSE' && message?.type !== 'FEASIBLE') return undefined;

  try {
    const doc = new DOMParser().parseFromString(message.html, 'text/html');
    sendResponse(
      message.type === 'PARSE'
        ? extract(doc, message.selector)
        : checkFeasible(doc, message.selector, message.seenText ?? '')
    );
  } catch (error) {
    sendResponse(
      message.type === 'PARSE'
        ? { found: false, reason: 'no-match' }
        : { canWatch: false, reason: `The page could not be read (${String(error)}).` }
    );
  }
  return true;
});
