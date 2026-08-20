import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNode } from '../constructors.js';
import { asNodeId, LockedError, Store, stripStrategy } from '../index.js';
import { DragProvider, useDragController } from './dnd/DragProvider.js';
import { useDragHandle } from './dnd/useDragHandle.js';
import { type ChromeMap, Container } from './index.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';
import { type ContainerLayout, useContainerLayout } from './useContainerLayout.js';

afterEach(cleanup);

const PANEL_CHROME: ChromeMap = {
  panel: ({ node }) => <div data-testid={`p-${node.id}`}>{String(node.id)}</div>,
};

function makeStripStore(): {
  store: Store;
  z: ReturnType<typeof asNodeId>;
  a: ReturnType<typeof asNodeId>;
  b: ReturnType<typeof asNodeId>;
} {
  const store = new Store();
  const z = asNodeId('z');
  const a = asNodeId('a');
  const b = asNodeId('b');
  store.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x' } },
      id: z,
    }),
  );
  store.registerNode(
    createNode({
      kind: 'panel',
      focus: true,
      id: a,
      parentId: z,
    }),
  );
  store.registerNode(
    createNode({
      kind: 'panel',
      focus: true,
      id: b,
      parentId: z,
    }),
  );
  store.showNode(a);
  store.showNode(b);
  return { store, z, a, b };
}

function withProviders(store: Store, ui: ReactNode) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy } as never}>
        {ui}
      </StrategyRegistryProvider>
    </Provider>
  );
}

describe('lock — affordance rendering', () => {
  it('gutter is present when no pane is resize-locked', () => {
    const { store, z } = makeStripStore();
    const { container } = render(
      withProviders(
        store,
        <Container parentId={z} chrome={PANEL_CHROME} viewport={{ w: 200, h: 100 }} affordances />,
      ),
    );
    expect(container.querySelector('[data-affordance-hit]')).not.toBeNull();
  });

  it('gutter is absent when an adjacent pane is resize-locked', () => {
    const { store, z, a } = makeStripStore();
    store.setLock(a, { resize: true });
    const { container } = render(
      withProviders(
        store,
        <Container parentId={z} chrome={PANEL_CHROME} viewport={{ w: 200, h: 100 }} affordances />,
      ),
    );
    expect(container.querySelector('[data-affordance-hit]')).toBeNull();
  });

  it('gutter disappears when a pane is locked after mount (memo invalidation)', () => {
    const { store, z, a } = makeStripStore();
    const { container } = render(
      withProviders(
        store,
        <Container parentId={z} chrome={PANEL_CHROME} viewport={{ w: 200, h: 100 }} affordances />,
      ),
    );
    expect(container.querySelector('[data-affordance-hit]')).not.toBeNull();
    act(() => {
      store.setLock(a, { resize: true });
    });
    expect(container.querySelector('[data-affordance-hit]')).toBeNull();
  });
});

describe('lock — dispatchAffordance refusal', () => {
  it('dispatch updates persisted placement size when unlocked (control)', () => {
    const { store, z, a } = makeStripStore();
    let layoutCapture: ContainerLayout | null = null;
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      const layout = useContainerLayout(z, ref, { w: 200, h: 100 });
      layoutCapture = layout;
      return <div ref={ref} />;
    }
    render(withProviders(store, <Probe />));
    expect(layoutCapture).not.toBeNull();
    act(() => {
      layoutCapture?.dispatchAffordance({
        affordanceId: 'resize-x-a',
        kind: 'drag',
        payload: { dx: 40 },
      });
    });
    expect(
      (store.getNode(a)?.membership?.placement as { size?: { w?: number } } | undefined)?.size?.w,
    ).toBeCloseTo(100 + 40, 5);
  });

  it('dispatch is refused on an arrange-locked container', () => {
    const { store, z, a } = makeStripStore();
    store.setLock(z, { arrange: true });
    let layoutCapture: ContainerLayout | null = null;
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      const layout = useContainerLayout(z, ref, { w: 200, h: 100 });
      layoutCapture = layout;
      return <div ref={ref} />;
    }
    render(withProviders(store, <Probe />));
    expect(layoutCapture).not.toBeNull();
    act(() => {
      layoutCapture?.dispatchAffordance({
        affordanceId: 'resize-x-a',
        kind: 'drag',
        payload: { dx: 40 },
      });
    });
    expect(
      (store.getNode(a)?.membership?.placement as { size?: unknown } | undefined)?.size,
    ).toBeUndefined();
  });

  it('dragging an unrelated gutter does not throw when another pane is resize-locked and sized', () => {
    // A single strip of a,b,c,d — d is resize-locked with an explicit size;
    // dragging the a/b gutter (affects only `a`) must not touch d, so it
    // must not hit d's lock.resize guard either.
    const store = new Store();
    const z = asNodeId('z');
    const a = asNodeId('a');
    const b = asNodeId('b');
    const c = asNodeId('c');
    const d = asNodeId('d');
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'x' } },
        id: z,
      }),
    );
    for (const id of [a, b, c, d]) {
      store.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id,
          parentId: z,
        }),
      );
      store.showNode(id);
    }
    store.patchPlacement(d, { size: { w: 50 } });
    store.setLock(d, { resize: true });

    let layoutCapture: ContainerLayout | null = null;
    function Probe() {
      const ref = useRef<HTMLDivElement>(null);
      const layout = useContainerLayout(z, ref, { w: 400, h: 100 });
      layoutCapture = layout;
      return <div ref={ref} />;
    }
    render(withProviders(store, <Probe />));
    expect(layoutCapture).not.toBeNull();
    const abGutter = layoutCapture!.affordances.find((aff) => aff.affects?.join(',') === a);
    expect(abGutter).toBeDefined();
    expect(() => {
      act(() => {
        layoutCapture?.dispatchAffordance({
          affordanceId: abGutter!.id,
          kind: 'drag',
          payload: { dx: 20 },
        });
      });
    }).not.toThrow();
    expect(
      (store.getNode(d)?.membership?.placement as { size?: unknown } | undefined)?.size,
    ).toEqual({ w: 50 });
  });
});

describe('lock — useDragHandle', () => {
  function wrapper(store: Store) {
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <Provider store={store}>
          <DragProvider>{children}</DragProvider>
        </Provider>
      );
    };
  }

  function fakeDown() {
    return {
      currentTarget: {},
      pointerId: 1,
      clientX: 0,
      clientY: 0,
    } as unknown as Parameters<ReturnType<typeof useDragHandle>['onPointerDown']>[0];
  }

  it('a move-unlocked node begins a drag (control)', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z'),
      }),
    );
    const { result } = renderHook(
      () => ({ controller: useDragController(), handlers: useDragHandle(asNodeId('p')) }),
      { wrapper: wrapper(store) },
    );
    act(() => {
      result.current.handlers.onPointerDown(fakeDown());
    });
    expect(result.current.controller.state()?.draggingId).toBe('p');
  });

  it('a move-locked node yields no-op drag handlers', () => {
    const store = new Store();
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'stack', config: {} },
        id: asNodeId('z'),
      }),
    );
    store.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: asNodeId('p'),
        parentId: asNodeId('z'),
      }),
    );
    store.setLock(asNodeId('p'), { move: true });
    const { result } = renderHook(
      () => ({ controller: useDragController(), handlers: useDragHandle(asNodeId('p')) }),
      { wrapper: wrapper(store) },
    );
    act(() => {
      result.current.handlers.onPointerDown(fakeDown());
    });
    expect(result.current.controller.state()).toBeNull();
  });
});

describe('lock — declarative `lock` and `pinned` props', () => {
  it('<Panel lock /> locks every axis the node supports', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('p')} lock />
        </Zone>
      </Provider>,
    );
    expect(store.getLock(asNodeId('p'))).toEqual({ move: true, resize: true, destroy: true });
  });

  it('<Panel lock={{ destroy: true }} /> locks exactly the given axes', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('p')} lock={{ destroy: true }} />
        </Zone>
      </Provider>,
    );
    expect(store.getLock(asNodeId('p'))).toEqual({ destroy: true });
  });

  it('<Panel pinned={0} /> on a panel that is not first moves it to index 0', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('a')} />
          <Panel id={asNodeId('b')} pinned={0} />
          <Panel id={asNodeId('c')} />
        </Zone>
      </Provider>,
    );
    expect(store.getPinnedIndex(asNodeId('b'))).toBe(0);
    expect(store.getContainerView(asNodeId('z'))?.childOrder[0]).toBe(asNodeId('b'));
  });

  it('<Panel pinned /> (bare) holds the current index without moving', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('a')} />
          <Panel id={asNodeId('b')} pinned />
          <Panel id={asNodeId('c')} />
        </Zone>
      </Provider>,
    );
    expect(store.getPinnedIndex(asNodeId('b'))).toBe(1);
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual([
      asNodeId('a'),
      asNodeId('b'),
      asNodeId('c'),
    ]);
  });

  it('rerendering lock={{ destroy: true }} → lock={false} clears the lock', () => {
    const store = new Store();
    const Tree = ({ locked }: { locked: boolean }) => (
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('p')} lock={locked ? { destroy: true } : false} />
        </Zone>
      </Provider>
    );
    const { rerender } = render(<Tree locked={true} />);
    expect(store.getLock(asNodeId('p'))).toEqual({ destroy: true });
    rerender(<Tree locked={false} />);
    expect(store.getLock(asNodeId('p'))).toEqual({});
  });

  it('rerendering pinned={0} → pinned={false} unpins', () => {
    const store = new Store();
    const Tree = ({ pinned }: { pinned: boolean | number }) => (
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('a')} />
          <Panel id={asNodeId('b')} pinned={pinned} />
        </Zone>
      </Provider>
    );
    const { rerender } = render(<Tree pinned={0} />);
    expect(store.getPinnedIndex(asNodeId('b'))).toBe(0);
    rerender(<Tree pinned={false} />);
    expect(store.getPinnedIndex(asNodeId('b'))).toBeNull();
  });

  it('generic `placement` prop rejects a `pinned` key, naming the dedicated prop', () => {
    const store = new Store();
    const Tree = ({ pinnedInPlacement }: { pinnedInPlacement: boolean }) => (
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('p')} placement={pinnedInPlacement ? { pinned: 0 } : {}} />
        </Zone>
      </Provider>
    );
    const { rerender } = render(<Tree pinnedInPlacement={false} />);
    // React surfaces the render-time throw via console.error; silence for this assertion.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => rerender(<Tree pinnedInPlacement={true} />)).toThrow(/dedicated `pinned` prop/);
    spy.mockRestore();
  });

  it('generic `placement` prop still applies `size`', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('p')} placement={{ size: 42 }} />
        </Zone>
      </Provider>,
    );
    expect(
      (store.getNode(asNodeId('p'))?.membership?.placement as { size?: unknown } | undefined)?.size,
    ).toBe(42);
  });
});

describe('lock — Zone `state` prop reconcile', () => {
  it('an arrange-locked Zone with a `state` prop mounts without throwing and leaves container state unchanged', () => {
    const store = new Store();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      render(
        withProviders(
          store,
          <Zone
            id={asNodeId('z')}
            strategyId="split"
            config={{}}
            viewport={{ w: 200, h: 100 }}
            lock={{ arrange: true }}
            state={{ kind: 'leaf', id: 'x' }}
          />,
        ),
      );
    }).not.toThrow();
    spy.mockRestore();
    expect(store.getContainerState(asNodeId('z'))).toBeUndefined();
  });

  it('an unlocked Zone with a `state` prop applies it (control)', () => {
    const store = new Store();
    render(
      withProviders(
        store,
        <Zone
          id={asNodeId('z')}
          strategyId="split"
          config={{}}
          viewport={{ w: 200, h: 100 }}
          state={{ kind: 'leaf', id: 'x' }}
        />,
      ),
    );
    expect(store.getContainerState(asNodeId('z'))).toEqual({ kind: 'leaf', id: 'x' });
  });
});

describe('lock — declarative `placement` reconcile forces past lock.resize', () => {
  it('a locked, fixed-size Panel survives repeated re-renders and applies its size', () => {
    const store = new Store();
    const Tree = () => (
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('p')} lock={{ resize: true }} placement={{ size: { w: 200 } }} />
        </Zone>
      </Provider>
    );
    const { rerender } = render(<Tree />);
    expect(() => rerender(<Tree />)).not.toThrow();
    expect(() => rerender(<Tree />)).not.toThrow();
    expect(
      (store.getNode(asNodeId('p'))?.membership?.placement as { size?: unknown } | undefined)?.size,
    ).toEqual({ w: 200 });
  });

  it('a free-form placement key still writes under a resize lock', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('p')} lock={{ resize: true }} placement={{ note: 'pinned-wide' }} />
        </Zone>
      </Provider>,
    );
    expect(
      (store.getNode(asNodeId('p'))?.membership?.placement as { note?: unknown } | undefined)?.note,
    ).toBe('pinned-wide');
  });

  it('a direct user-path store.patchPlacement resize is still blocked under lock.resize', () => {
    const { store, a } = makeStripStore();
    store.setLock(a, { resize: true });
    expect(() => store.patchPlacement(a, { size: { w: 50 } })).toThrow(LockedError);
  });

  it('affordance suppression from lock.resize is unaffected (gutter still hidden)', () => {
    const { store, z, a } = makeStripStore();
    store.setLock(a, { resize: true });
    const { container } = render(
      withProviders(
        store,
        <Container parentId={z} chrome={PANEL_CHROME} viewport={{ w: 200, h: 100 }} affordances />,
      ),
    );
    expect(container.querySelector('[data-affordance-hit]')).toBeNull();
  });
});

describe('lock — declarative `pinned` reconcile skips under lock.arrange', () => {
  it('an arrange-locked Zone with a pinned Panel mounts without throwing and leaves childOrder/pinning untouched', () => {
    const store = new Store();
    expect(() => {
      render(
        <Provider store={store}>
          <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }} lock={{ arrange: true }}>
            <Panel id={asNodeId('a')} />
            <Panel id={asNodeId('p')} pinned={0} />
          </Zone>
        </Provider>,
      );
    }).not.toThrow();
    expect(store.getPinnedIndex(asNodeId('p'))).toBeNull();
    expect(store.getContainerView(asNodeId('z'))?.childOrder).toEqual([
      asNodeId('a'),
      asNodeId('p'),
    ]);
  });

  it('the same tree without the lock still pins correctly (control)', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }}>
          <Panel id={asNodeId('a')} />
          <Panel id={asNodeId('p')} pinned={0} />
        </Zone>
      </Provider>,
    );
    expect(store.getPinnedIndex(asNodeId('p'))).toBe(0);
    expect(store.getContainerView(asNodeId('z'))?.childOrder?.[0]).toBe(asNodeId('p'));
  });

  it('an imperative unlock re-runs the pending `pinned` reconcile with no other render trigger', () => {
    const store = new Store();
    render(
      <Provider store={store}>
        <Zone id={asNodeId('z')} strategyId="grid" config={{ cols: 1 }} lock={{ arrange: true }}>
          <Panel id={asNodeId('a')} />
          <Panel id={asNodeId('p')} pinned={0} />
        </Zone>
      </Provider>,
    );
    expect(store.getPinnedIndex(asNodeId('p'))).toBeNull();
    act(() => {
      store.setLock(asNodeId('z'), { arrange: false });
    });
    expect(store.getPinnedIndex(asNodeId('p'))).toBe(0);
    expect(store.getContainerView(asNodeId('z'))?.childOrder?.[0]).toBe(asNodeId('p'));
  });
});
