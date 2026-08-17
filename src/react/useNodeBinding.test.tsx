import { cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asNodeId, createPanel, createZone, LockedError, Store } from '../index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { useNodeBinding } from './useNodeBinding.js';

afterEach(cleanup);

function TestPanel(props: {
  id?: string;
  parentId: string; // required for these tests
  meta?: Record<string, unknown>;
}) {
  useNodeBinding({
    ...(props.id ? { id: asNodeId(props.id) } : {}),
    parentId: asNodeId(props.parentId),
    kindHintForAutoId: 'panel',
    factory: (id, parentId) =>
      createPanel({
        id,
        parentId: parentId ?? asNodeId(props.parentId),
        ...(props.meta !== undefined ? { meta: props.meta } : {}),
      }),
    reconcile: (store, id) => {
      if (props.meta !== undefined) store.setMeta(id, props.meta);
    },
  });
  return null;
}

function setupStore(): Store {
  const s = new Store();
  s.registerNode(createZone({ id: asNodeId('root'), strategyId: 'stack', config: {} }));
  return s;
}

describe('useNodeBinding', () => {
  it('registers on mount, unregisters on unmount', () => {
    const store = setupStore();
    const { unmount } = render(
      <Provider store={store}>
        <TestPanel id="a" parentId="root" />
      </Provider>,
    );
    expect(store.getNode(asNodeId('a'))).toBeTruthy();
    unmount();
    expect(store.getNode(asNodeId('a'))).toBeUndefined();
  });

  it('reconciles meta on re-render', () => {
    const store = setupStore();
    const { rerender } = render(
      <Provider store={store}>
        <TestPanel id="a" parentId="root" meta={{ title: 'A1' }} />
      </Provider>,
    );
    expect((store.getNode(asNodeId('a'))!.meta as Record<string, unknown>).title).toBe('A1');
    rerender(
      <Provider store={store}>
        <TestPanel id="a" parentId="root" meta={{ title: 'A2' }} />
      </Provider>,
    );
    expect((store.getNode(asNodeId('a'))!.meta as Record<string, unknown>).title).toBe('A2');
  });

  it('mints a stable id when none is provided', () => {
    const store = setupStore();
    render(
      <Provider store={store}>
        <TestPanel parentId="root" />
      </Provider>,
    );
    const childOrder = store.getContainerView(asNodeId('root'))?.childOrder ?? [];
    expect(childOrder.length).toBe(1);
    expect(childOrder[0]).toMatch(/^panel-/);
  });

  it('is idempotent under StrictMode double-mount', () => {
    const store = setupStore();
    render(
      <StrictMode>
        <Provider store={store}>
          <TestPanel id="a" parentId="root" />
        </Provider>
      </StrictMode>,
    );
    expect(store.getNode(asNodeId('a'))).toBeTruthy();
    const childOrder = store.getContainerView(asNodeId('root'))?.childOrder ?? [];
    expect(childOrder.filter((id) => id === asNodeId('a')).length).toBe(1);
  });

  it('throws when id prop changes without a key', () => {
    const store = setupStore();
    const Tree = ({ id }: { id: string }) => (
      <Provider store={store}>
        <TestPanel id={id} parentId="root" />
      </Provider>
    );
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(<Tree id="a" />);
    expect(() => rerender(<Tree id="b" />)).toThrow(/id changed.*without a key/);
    spy.mockRestore();
  });

  it('reconciles current props on the StrictMode recovery remount', () => {
    // After StrictMode's mount→cleanup→remount cycle, the reconcile callback
    // should run against the *current* meta — not stale closure values.
    const store = setupStore();
    render(
      <StrictMode>
        <Provider store={store}>
          <TestPanel id="a" parentId="root" meta={{ title: 'initial' }} />
        </Provider>
      </StrictMode>,
    );
    expect((store.getNode(asNodeId('a'))!.meta as Record<string, unknown>).title).toBe('initial');
  });

  describe('unmount cleanup forces past lock.destroy', () => {
    it('unmounting a destroy-locked Panel does not throw and removes the node', () => {
      const store = setupStore();
      const { unmount } = render(
        <Provider store={store}>
          <Panel id={asNodeId('p')} parentId={asNodeId('root')} lock={{ destroy: true }} />
        </Provider>,
      );
      expect(store.getNode(asNodeId('p'))).toBeTruthy();
      expect(() => unmount()).not.toThrow();
      expect(store.getNode(asNodeId('p'))).toBeUndefined();
    });

    it('remounting a destroy-locked Panel at the same id after unmount works', () => {
      const store = new Store();
      const Tree = ({ mounted }: { mounted: boolean }) => (
        <Provider store={store}>
          <Zone id={asNodeId('root')} strategyId="stack" config={{}}>
            {mounted && <Panel id={asNodeId('p')} lock={{ destroy: true }} />}
          </Zone>
        </Provider>
      );
      const { rerender } = render(<Tree mounted={true} />);
      rerender(<Tree mounted={false} />);
      expect(store.getNode(asNodeId('p'))).toBeUndefined();
      expect(() => rerender(<Tree mounted={true} />)).not.toThrow();
      expect(store.getNode(asNodeId('p'))).toBeTruthy();
    });

    it('a direct user-path store.unregisterNode is still blocked under lock.destroy', () => {
      const store = setupStore();
      store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('root') }));
      store.setLock(asNodeId('p'), { destroy: true });
      expect(() => store.unregisterNode(asNodeId('p'))).toThrow(LockedError);
    });
  });
});
