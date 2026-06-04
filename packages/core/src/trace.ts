/**
 * Optional debug tracing. Disabled by default; zero cost when off.
 *
 * Enable via one of:
 *  - env (Node):  WINDEASE_TRACE=dnd,history npm test
 *  - browser:     localStorage.setItem('windease.trace', 'dnd,history,*')
 *  - browser:     window.WINDEASE_TRACE = 'dnd'
 *  - runtime:     import { configureTrace } from '@windease/core'; configureTrace('*');
 *
 * Categories are checked at call time, so toggling at runtime takes effect
 * immediately.
 */

export const TRACE_CATEGORIES = [
  'dnd',
  'history',
  'layout',
  'store',
  'workspace',
  'zone',
] as const;
export type TraceCategory = (typeof TRACE_CATEGORIES)[number];

let enabled: Set<TraceCategory> = new Set();

export function configureTrace(spec: string | readonly TraceCategory[] | '*' | null): void {
  if (spec === null || spec === '') {
    enabled = new Set();
    return;
  }
  if (spec === '*') {
    enabled = new Set(TRACE_CATEGORIES);
    return;
  }
  if (Array.isArray(spec)) {
    enabled = new Set(spec);
    return;
  }
  const parts = (spec as string)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.includes('*')) {
    enabled = new Set(TRACE_CATEGORIES);
    return;
  }
  enabled = new Set(
    parts.filter((p): p is TraceCategory =>
      (TRACE_CATEGORIES as readonly string[]).includes(p),
    ),
  );
}

export function isTraceEnabled(category: TraceCategory): boolean {
  return enabled.has(category);
}

export function trace(category: TraceCategory, message: string, data?: unknown): void {
  if (!enabled.has(category)) return;
  const tag = `[windease:${category}]`;
  if (data !== undefined) {
    // biome-ignore lint/suspicious/noConsole: trace is opt-in diagnostics
    console.debug(tag, message, data);
  } else {
    // biome-ignore lint/suspicious/noConsole: trace is opt-in diagnostics
    console.debug(tag, message);
  }
}

function readInitialConfig(): void {
  let raw: string | undefined | null;
  if (typeof process !== 'undefined' && process.env) {
    raw = process.env.WINDEASE_TRACE;
  }
  if (!raw && typeof globalThis !== 'undefined') {
    const g = globalThis as { localStorage?: Storage; WINDEASE_TRACE?: string };
    if (typeof g.WINDEASE_TRACE === 'string') {
      raw = g.WINDEASE_TRACE;
    } else if (g.localStorage) {
      try {
        raw = g.localStorage.getItem('windease.trace') ?? undefined;
      } catch {
        // ignore — some sandboxed contexts deny access
      }
    }
  }
  if (raw) configureTrace(raw);
}

readInitialConfig();
