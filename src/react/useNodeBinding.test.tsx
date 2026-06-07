import { render, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { Store, asNodeId, createPanel, createZone } from '../index.js';
import { Provider } from './Provider.js';
import { useNodeBinding } from './useNodeBinding.js';

afterEach(cleanup);

function TestPanel(props: {
  id?: string;
  parentId: string; // required for these tests
  meta?: Record<string, unknown>;
}) {
  useNodeBinding({
    id: props.id ? asNodeId(props.id) : undefined,
    parentId: asNodeId(props.parentId),
    kindHintForAutoId: 'panel',
    factory: (id, parentId) =>
      createPanel({
        id,
        parentId: parentId!,
        meta: props.meta,
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
    expect(
      (store.getNode(asNodeId('a'))?.meta as Record<string, unknown>).title,
    ).toBe('A1');
    rerender(
      <Provider store={store}>
        <TestPanel id="a" parentId="root" meta={{ title: 'A2' }} />
      </Provider>,
    );
    expect(
      (store.getNode(asNodeId('a'))?.meta as Record<string, unknown>).title,
    ).toBe('A2');
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
    expect((store.getNode(asNodeId('a'))?.meta as Record<string, unknown>).title).toBe(
      'initial',
    );
  });
});
