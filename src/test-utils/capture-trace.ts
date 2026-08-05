import { onTestFinished } from 'vitest';
import { TRACE_CATEGORIES, type TraceCategory, configureTrace, isTraceEnabled } from '../trace.js';

export interface TraceCapture {
  /** Rendered trace lines, in emission order: `"[windease:cat] message"`,
   *  with any `data` argument JSON-appended. */
  readonly lines: readonly string[];
  /** The subset of `lines` hitting `pattern`. */
  matching(pattern: RegExp): string[];
  /** Restore the previous trace config and `console.log`. Idempotent, and
   *  run automatically when the current test ends. */
  stop(): void;
}

/**
 * Capture `trace()` output for the given categories.
 *
 * Some behavior is only observable through a trace — `throttle.published`'s
 * `removed` flag reaches no payload and no return value — so without this
 * there is no way to assert on it at all.
 *
 * Traces land on `console.log`, so capturing means replacing it. The
 * replacement swallows only `[windease:*]` lines and forwards everything
 * else, and is torn down by `onTestFinished` whether or not `stop()` is
 * called.
 */
export function captureTrace(...categories: TraceCategory[]): TraceCapture {
  const previous = TRACE_CATEGORIES.filter(isTraceEnabled);
  const originalLog = console.log;
  const lines: string[] = [];
  let active = true;

  console.log = (...args: unknown[]): void => {
    const [tag, message, data] = args;
    if (typeof tag === 'string' && tag.startsWith('[windease:')) {
      lines.push(
        data === undefined ? `${tag} ${message}` : `${tag} ${message} ${JSON.stringify(data)}`,
      );
      return;
    }
    originalLog(...args);
  };
  configureTrace(categories);

  const stop = (): void => {
    if (!active) return;
    active = false;
    console.log = originalLog;
    configureTrace(previous);
  };
  onTestFinished(stop);

  return {
    lines,
    matching: (pattern: RegExp) => lines.filter((l) => pattern.test(l)),
    stop,
  };
}
