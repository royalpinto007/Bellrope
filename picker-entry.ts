import { pickInPage } from './src/picker.js';
import { stableSelector } from './src/selector.js';

/**
 * The script injected to run the picker.
 *
 * The selector builder is bundled in here rather than passed as a function,
 * because executeScript serialises a function's source and would strip its
 * imports. The picker calls it through window so the two stay separable.
 */
window.__bellropeSelector = stableSelector;
window.__bellropePick = pickInPage();

export {};
