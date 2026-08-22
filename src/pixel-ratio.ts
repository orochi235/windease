import { trace } from './trace.js';

/**
 * Report `devicePixelRatio` now, and again whenever it changes. Returns a
 * teardown.
 *
 * The DOM convenience a canvas host wants: placements arrive in CSS pixels,
 * which is most of what a backing store needs, but a ratio change still means
 * every canvas must be resized. Dragging a window between displays is the
 * common case.
 *
 * Deliberately not on `ContainerHost`: no strategy reads the ratio and no
 * placement changes with it, so routing it through the layout host would make
 * the host a bus for a value it never consumes. A ratio change and a placement
 * change are two independent triggers for the same host-side resize.
 *
 * The callback fires once on subscribe, so a host can prime and update through
 * one path.
 */
export function observePixelRatio(cb: (ratio: number) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const read = (): number => window.devicePixelRatio || 1;

  if (typeof window.matchMedia !== 'function') {
    cb(read());
    return () => {};
  }

  let live: { mql: MediaQueryList; handler: () => void } | null = null;
  let stopped = false;
  let last = read();

  const detach = (): void => {
    live?.mql.removeEventListener('change', live.handler);
    live = null;
  };

  // A resolution query embeds the ratio it was built with, so its listener
  // fires once and is then permanently false. Every change has to re-arm at the
  // new ratio or the second change is never heard.
  const arm = (): void => {
    detach();
    if (stopped) return;
    const mql = window.matchMedia(`(resolution: ${read()}dppx)`);
    const handler = (): void => {
      arm();
      const next = read();
      if (next === last) return;
      last = next;
      trace('zone', `dpr: ${next} — backing stores need resizing`);
      cb(next);
    };
    mql.addEventListener('change', handler);
    live = { mql, handler };
  };

  arm();
  cb(last);

  return () => {
    stopped = true;
    detach();
  };
}
