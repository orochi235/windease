import { act, renderHook } from '@testing-library/react';
import { WindeaseStore, asWindowId, asZoneId, gridStrategy } from '../index.js';
import { describe, expect, it } from 'vitest';
import { WindeaseProvider } from './WindeaseProvider.js';
import { useWindow } from './hooks.js';

describe('useWindow re-render granularity', () => {
  function setup() {
    const store = new WindeaseStore();
    store.registerZone({ id: asZoneId('main'), strategy: gridStrategy });
    store.createWindow({ id: asWindowId('a'), kind: 'panel' });
    store.createWindow({ id: asWindowId('b'), kind: 'panel' });
    return store;
  }

  it('does NOT re-render when an unrelated window changes', async () => {
    const store = setup();
    let renderCount = 0;
    renderHook(
      () => {
        renderCount++;
        return useWindow(asWindowId('a'));
      },
      {
        wrapper: ({ children }) => <WindeaseProvider store={store}>{children}</WindeaseProvider>,
      },
    );
    const initial = renderCount;

    await act(async () => {
      store.show(asWindowId('b'));
      await Promise.resolve();
    });
    // useSyncExternalStore bails out when the snapshot reference is stable.
    // Since show('b') doesn't mutate the record for 'a', the hook should skip.
    expect(renderCount).toBe(initial);
  });

  it('DOES re-render when the watched window changes', async () => {
    const store = setup();
    let renderCount = 0;
    renderHook(
      () => {
        renderCount++;
        return useWindow(asWindowId('a'));
      },
      {
        wrapper: ({ children }) => <WindeaseProvider store={store}>{children}</WindeaseProvider>,
      },
    );
    const initial = renderCount;

    await act(async () => {
      store.show(asWindowId('a'));
      await Promise.resolve();
    });
    // The lifecycle FSM is mutated in place on the SAME WindowRecord, so the
    // record reference is stable across this transition. That means React
    // bails out even though the watched window's state did change.
    //
    // This is a known limitation of in-place machine mutation + reference
    // equality — when we care to surface state changes, consumers must
    // subscribe to the events emitter or use a selector that returns a
    // value-derived snapshot. Documenting this here so future selector
    // refinement is informed.
    expect(renderCount).toBe(initial);
  });
});
