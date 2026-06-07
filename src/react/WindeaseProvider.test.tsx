import { render, renderHook } from '@testing-library/react';
import {
  HistoryController,
  type SerializedStore,
  WindeaseStore,
  asWindowId,
  asZoneId,
  gridStrategy,
} from '../index.js';
import { describe, expect, it } from 'vitest';
import { WindeaseProvider } from './WindeaseProvider.js';
import { useWindease } from './hooks.js';

describe('WindeaseProvider', () => {
  it('exposes a passed store via useWindease', () => {
    const store = new WindeaseStore();
    const { result } = renderHook(() => useWindease(), {
      wrapper: ({ children }) => <WindeaseProvider store={store}>{children}</WindeaseProvider>,
    });
    expect(result.current).toBe(store);
  });

  it('constructs a store from zones prop when none is given', () => {
    const { result } = renderHook(() => useWindease(), {
      wrapper: ({ children }) => (
        <WindeaseProvider
          zones={[{ id: asZoneId('main'), strategy: gridStrategy, config: { cols: 2 } }]}
        >
          {children}
        </WindeaseProvider>
      ),
    });
    expect(result.current.getZone(asZoneId('main'))?.strategy.name).toBe('grid');
  });

  it('useWindease throws helpful error outside provider', () => {
    expect(() => renderHook(() => useWindease())).toThrow(/WindeaseProvider/);
  });

  it('history hookup pushes initial snapshot and on store events', () => {
    const store = new WindeaseStore();
    store.registerZone({ id: asZoneId('z'), strategy: gridStrategy, config: {} });
    const controller = new HistoryController<SerializedStore>();
    const capture = () => store.snapshot();
    const restore = (snap: SerializedStore) =>
      store.hydrate(snap, { strategies: { grid: gridStrategy } });

    render(
      <WindeaseProvider store={store} history={{ controller, capture, restore }}>
        <div />
      </WindeaseProvider>,
    );

    expect(controller.canUndo()).toBe(false);
    expect(controller.current()).toBeDefined();

    store.createWindow({ id: asWindowId('w'), kind: 'panel' });
    expect(controller.canUndo()).toBe(true);

    const prev = controller.undo();
    expect(prev).toBeDefined();
    if (prev) restore(prev);
    expect(store.getWindow(asWindowId('w'))).toBeUndefined();
  });
});
