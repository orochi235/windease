import { describe, expect, it } from 'vitest';
import { configureTrace, isTraceEnabled, trace } from '../trace.js';
import { captureTrace } from './capture-trace.js';

describe('captureTrace', () => {
  it('collects lines for the requested category', () => {
    const cap = captureTrace('throttle');
    trace('throttle', 'published: p held 12ms');
    expect(cap.lines).toEqual(['[windease:throttle] published: p held 12ms']);
  });

  it('appends the data argument so payload fields are matchable', () => {
    const cap = captureTrace('layout');
    trace('layout', 'grid: 2 items', { unplaced: 1 });
    expect(cap.lines[0]).toBe('[windease:layout] grid: 2 items {"unplaced":1}');
  });

  it('ignores categories it was not asked for', () => {
    const cap = captureTrace('throttle');
    trace('layout', 'grid: 2 items');
    expect(cap.lines).toEqual([]);
  });

  it('matching() filters to lines hitting a pattern', () => {
    const cap = captureTrace('throttle');
    trace('throttle', 'published: a held 0ms (removed)');
    trace('throttle', 'published: b held 0ms');
    expect(cap.matching(/\(removed\)/)).toEqual([
      '[windease:throttle] published: a held 0ms (removed)',
    ]);
  });

  it('restores the previous trace configuration on stop()', () => {
    configureTrace('history');
    const cap = captureTrace('throttle');
    expect(isTraceEnabled('throttle')).toBe(true);

    cap.stop();

    expect(isTraceEnabled('throttle')).toBe(false);
    expect(isTraceEnabled('history')).toBe(true);
    configureTrace(null);
  });

  // These two run in order: the first deliberately leaks, the second
  // proves the leak was cleaned up when its test ended.
  const pristineLog = console.log;
  it('leaves a capture unstopped', () => {
    const cap = captureTrace('throttle');
    trace('throttle', 'published: p held 12ms');
    expect(cap.lines).toHaveLength(1);
  });

  it('restores itself when the test that made it ends', () => {
    expect(console.log).toBe(pristineLog);
    expect(isTraceEnabled('throttle')).toBe(false);
  });

  it('stops collecting after stop()', () => {
    const cap = captureTrace('throttle');
    cap.stop();
    trace('throttle', 'published: p held 12ms');
    expect(cap.lines).toEqual([]);
  });
});
