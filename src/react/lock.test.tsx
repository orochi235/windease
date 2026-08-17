import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPanel, createZone } from '../constructors.js';
import { asNodeId, Store, splitStrategy } from '../index.js';
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

function makeSplitStore(): {
  store: Store;
  z: ReturnType<typeof asNodeId>;
  a: ReturnType<typeof asNodeId>;
  b: ReturnType<typeof asNodeId>;
} {
  const store = new Store();
  const z = asNodeId('z');
  const a = asNodeId('a');
  const b = asNodeId('b');
  store.registerNode(createZone({ id: z, strategyId: 'split', config: {} }));
  store.registerNode(createPanel({ id: a, parentId: z }));
  store.registerNode(createPanel({ id: b, parentId: z }));
  store.showNode(a);
  store.showNode(b);
  return { store, z, a, b };
}

function withProviders(store: Store, ui: ReactNode) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ split: splitStrategy } as never}>
        {ui}
      </StrategyRegistryProvider>
    </Provider>
  );
}

describe('lock — affordance rendering', () => {
  it('gutter is present when no pane is resize-locked', () => {
    const { store, z } = makeSplitStore();
    const { container } = render(
      withProviders(
        store,
        <Container parentId={z} chrome={PANEL_CHROME} viewport={{ w: 200, h: 100 }} affordances />,
      ),
    );
    expect(container.querySelector('[data-affordance-hit]')).not.toBeNull();
  });

  it('gutter is absent when an adjacent pane is resize-locked', () => {
    const { store, z, a } = makeSplitStore();
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
    const { store, z, a } = makeSplitStore();
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
  it('dispatch updates persisted container state when unlocked (control)', () => {
    const { store, z } = makeSplitStore();
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
        affordanceId: 'split-',
        kind: 'drag',
        payload: { dx: 40 },
      });
    });
    const state = store.getContainerState(z) as { ratio?: number } | undefined;
    expect(state?.ratio).toBeCloseTo(0.5 + 40 / 200, 5);
  });

  it('dispatch is refused on an arrange-locked container', () => {
    const { store, z, a } = makeSplitStore();
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
        affordanceId: 'split-',
        kind: 'drag',
        payload: { dx: 40 },
      });
    });
    expect(store.getContainerState(z)).toBeUndefined();
    expect(
      (store.getNode(a)?.membership?.placement as { size?: unknown } | undefined)?.size,
    ).toBeUndefined();
  });

  it('dragging an unrelated gutter does not throw when another pane is resize-locked and sized', () => {
    // root: split(split(a,b), split(c,d)) — d is resize-locked with an
    // explicit size; dragging the a/b gutter must not touch d, so it must
    // not hit d's lock.resize guard either.
    const store = new Store();
    const z = asNodeId('z');
    const a = asNodeId('a');
    const b = asNodeId('b');
    const c = asNodeId('c');
    const d = asNodeId('d');
    store.registerNode(createZone({ id: z, strategyId: 'split', config: {} }));
    for (const id of [a, b, c, d]) {
      store.registerNode(createPanel({ id, parentId: z }));
      store.showNode(id);
    }
    store.setContainerState(z, {
      kind: 'split',
      direction: 'horizontal',
      ratio: 0.5,
      a: {
        kind: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        a: { kind: 'leaf', id: a },
        b: { kind: 'leaf', id: b },
      },
      b: {
        kind: 'split',
        direction: 'horizontal',
        ratio: 0.5,
        a: { kind: 'leaf', id: c },
        b: { kind: 'leaf', id: d },
      },
    });
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
    const abGutter = layoutCapture!.affordances.find(
      (aff) => aff.affects?.join(',') === `${a},${b}`,
    );
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
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
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
    store.registerNode(createZone({ id: asNodeId('z'), strategyId: 'stack', config: {} }));
    store.registerNode(createPanel({ id: asNodeId('p'), parentId: asNodeId('z') }));
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
