/**
 * Choosing what to watch, in the page.
 *
 * Runs as an injected function, so it is self-contained by necessity: it can
 * reference nothing from the extension's scope. Kept here rather than inline
 * in the worker so it can be read on its own.
 *
 * Resolves when the user clicks something, or when they press Escape. Every
 * listener is removed on either path, because a picker left armed on someone's
 * banking page is the worst thing this extension could do.
 */
export function pickInPage(): Promise<{ selector: string; text: string; title: string } | null> {
  return new Promise((resolve) => {
    const OUTLINE = '__bellrope-outline';
    const HINT = '__bellrope-hint';

    const outline = document.createElement('div');
    outline.id = OUTLINE;
    outline.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #7a5cff;border-radius:3px;background:rgba(122,92,255,.12);transition:all .06s';

    const hint = document.createElement('div');
    hint.id = HINT;
    hint.textContent = 'Click what you want to watch. Escape to cancel.';
    hint.style.cssText =
      'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;background:#17141f;color:#fff;font:14px system-ui,sans-serif;padding:9px 16px;border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.3);pointer-events:none';

    document.body.append(outline, hint);

    let current: Element | null = null;

    const move = (event: MouseEvent) => {
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || el.id === OUTLINE || el.id === HINT) return;
      current = el;
      const box = el.getBoundingClientRect();
      outline.style.top = `${box.top - 2}px`;
      outline.style.left = `${box.left - 2}px`;
      outline.style.width = `${box.width + 4}px`;
      outline.style.height = `${box.height + 4}px`;
    };

    const done = (value: { selector: string; text: string; title: string } | null) => {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
      outline.remove();
      hint.remove();
      resolve(value);
    };

    const click = (event: MouseEvent) => {
      // Capture phase and full suppression: the click must not reach the page,
      // or picking a "Buy now" button would buy the thing.
      event.preventDefault();
      event.stopPropagation();
      const el = current;
      if (!el) return done(null);
      done({
        selector: window.__bellropeSelector(el),
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
        title: document.title,
      });
    };

    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        done(null);
      }
    };

    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
  });
}

declare global {
  interface Window {
    __bellropeSelector: (el: Element) => string;
    __bellropePick?: Promise<{ selector: string; text: string; title: string } | null>;
  }
}
