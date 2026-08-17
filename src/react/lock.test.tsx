import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createPanel, createZone } from '../constructors.js';
import { asNodeId, Store, splitStrategy } from '../index.js';
import { DragProvider, useDragController } from './dnd/DragProvider.js';
import { useDragHandle } from './dnd/useDragHandle.js';
import { type ChromeMap, Container } from './index.js';
import { Provider } from './Provider.js';
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
