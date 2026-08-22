import { fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createNode } from '../constructors.js';
import { stripStrategy } from '../index.js';
import { asNodeId } from '../node.js';
import { Store } from '../store.js';
import { recordEvents } from '../test-utils/record-events.js';
import { type ChromeMap, Container } from './index.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

/** Three 200px panes in a 600px strip, each with an 80px floor. */
function seed(lockB = false) {
  const store = new Store();
  store.registerNode(
    createNode({
      id: asNodeId('root'),
      kind: 'zone',
      container: {
        strategyId: 'strip',
        config: {
          axis: 'x',
          gap: 0,
          padding: 0,
          resizeMode: 'neighbor',
          joinOnOvershoot: true,
          joinThreshold: 24,
        },
      },
    }),
  );
  for (const id of ['a', 'b', 'c']) {
    store.registerNode(
      createNode({
        id: asNodeId(id),
        kind: 'panel',
        focus: true,
        parentId: asNodeId('root'),
        placement: { size: { w: 200 } },
        hints: { minSize: { w: 80, h: 0 } },
        ...(lockB && id === 'b' ? { lock: { destroy: true } } : {}),
      }),
    );
    store.showNode(asNodeId(id));
  }
  return store;
}

const PANEL_CHROME: ChromeMap = {
  panel: ({ node }) => <div data-testid={`p-${node.id}`}>{String(node.id)}</div>,
};

function withProviders(store: Store, ui: ReactNode) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy } as never}>
        {ui}
      </StrategyRegistryProvider>
    </Provider>
  );
}

function mount(store: Store) {
  const { container } = render(
    withProviders(
      store,
      <Container
        parentId={asNodeId('root')}
        chrome={PANEL_CHROME}
        viewport={{ w: 600, h: 200 }}
        affordances
      />,
    ),
  );
  const seam = container.querySelector('[data-affordance-hit="resize-x-a"]');
  if (!seam) throw new Error('seam resize-x-a not rendered');
  return { container, seam: seam as HTMLElement };
}

/** Pointer travel in <threshold steps, so the one-frame prop lag never looks
 *  like overshoot on its own. Returns the clientX it left the pointer at. */
function drag(seam: HTMLElement, total: number, from = 0, step = 10): number {
  const dir = Math.sign(total);
  let moved = 0;
  let x = from;
  while (moved !== total) {
    const d = dir * Math.min(step, Math.abs(total - moved));
    moved += d;
    x += d;
    fireEvent.pointerMove(seam, { pointerId: 1, clientX: x, clientY: 0 });
  }
  return x;
}

function down(seam: HTMLElement, at = 0) {
  fireEvent.pointerDown(seam, { pointerId: 1, clientX: at, clientY: 0 });
}

function up(seam: HTMLElement, at: number) {
  fireEvent.pointerUp(seam, { pointerId: 1, clientX: at, clientY: 0 });
}

function armedPane(container: HTMLElement): string | null {
  const el = container.querySelector('[data-node][data-join-armed]');
  return el ? el.getAttribute('data-node') : null;
}

function widthOf(store: Store, id: string): number | undefined {
  return (store.getPlacement(asNodeId(id)).size as { w?: number } | undefined)?.w;
}

describe('seam join — arming', () => {
  let store: Store;
  beforeEach(() => {
    store = seed();
  });

  it('a resize inside the neighbor floor does not arm', () => {
    const { container, seam } = mount(store);
    down(seam);
    const x = drag(seam, 60);
    expect(armedPane(container)).toBeNull();
    up(seam, x);
    expect(store.getNode(asNodeId('b'))).toBeDefined();
  });

  it('pushing past the floor by more than the threshold arms the victim', () => {
    const { container, seam } = mount(store);
    down(seam);
    drag(seam, 145);
    expect(armedPane(container)).toBe('b');
    expect(container.querySelector('[data-affordance-hit][data-join-armed]')).not.toBeNull();
  });

  it('releasing while armed destroys the victim and leaves its siblings', () => {
    const { seam } = mount(store);
    down(seam);
    const x = drag(seam, 145);
    up(seam, x);
    expect(store.getNode(asNodeId('b'))).toBeUndefined();
    expect(store.getNode(asNodeId('a'))).toBeDefined();
    expect(store.getNode(asNodeId('c'))).toBeDefined();
  });

  it('backing off under the threshold disarms, and release keeps the pane', () => {
    const { container, seam } = mount(store);
    down(seam);
    let x = drag(seam, 145);
    expect(armedPane(container)).toBe('b');
    x = drag(seam, -10, x);
    expect(armedPane(container)).toBeNull();
    up(seam, x);
    expect(store.getNode(asNodeId('b'))).toBeDefined();
  });

  it('a destroy-locked pane never arms, but the resize still clamps against it', () => {
    const locked = seed(true);
    const { container, seam } = mount(locked);
    down(seam);
    const x = drag(seam, 300);
    expect(armedPane(container)).toBeNull();
    up(seam, x);
    expect(locked.getNode(asNodeId('b'))).toBeDefined();
    expect(widthOf(locked, 'a')).toBe(320);
  });

  // The first gesture ends 20px past the floor — under the 24px threshold, but
  // enough that carrying it into the next gesture would arm on the first move.
  it('overshoot resets per gesture', () => {
    const { container, seam } = mount(store);
    down(seam);
    let x = drag(seam, 140);
    expect(armedPane(container)).toBeNull();
    up(seam, x);
    down(seam, x);
    x = drag(seam, 10, x);
    expect(armedPane(container)).toBeNull();
    up(seam, x);
    expect(store.getNode(asNodeId('b'))).toBeDefined();
  });
});

describe('seam join — abandoning the gesture', () => {
  it('pointercancel while armed does not destroy and clears the marking', () => {
    const store = seed();
    const { container, seam } = mount(store);
    down(seam);
    const x = drag(seam, 145);
    expect(armedPane(container)).toBe('b');
    fireEvent.pointerCancel(seam, { pointerId: 1, clientX: x, clientY: 0 });
    expect(store.getNode(asNodeId('b'))).toBeDefined();
    expect(armedPane(container)).toBeNull();
  });

  it('Escape while armed does not destroy, and a later pointerup does not either', () => {
    const store = seed();
    const { container, seam } = mount(store);
    down(seam);
    const x = drag(seam, 145);
    expect(armedPane(container)).toBe('b');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(store.getNode(asNodeId('b'))).toBeDefined();
    expect(armedPane(container)).toBeNull();
    up(seam, x);
    expect(store.getNode(asNodeId('b'))).toBeDefined();
  });
});

describe('seam join — store consequences', () => {
  it('destroys inside a single transaction', () => {
    const store = seed();
    const { seam } = mount(store);
    down(seam);
    const x = drag(seam, 145);
    const rec = recordEvents(store, 'transaction.begin', 'transaction.end');
    up(seam, x);
    rec.stop();
    expect(store.getNode(asNodeId('b'))).toBeUndefined();
    expect(rec.of('transaction.begin')).toHaveLength(1);
    expect(rec.of('transaction.end')).toHaveLength(1);
  });

  it('leaves an autoUnsplit root standing — coalesceParent needs a grandparent', () => {
    const store = seed();
    store.setAutoUnsplit(asNodeId('root'), true);
    store.unregisterNode(asNodeId('c'));
    const { seam } = mount(store);
    down(seam);
    const x = drag(seam, 145);
    up(seam, x);
    expect(store.getNode(asNodeId('b'))).toBeUndefined();
    expect(store.getNode(asNodeId('root'))).toBeDefined();
    expect(store.getNode(asNodeId('a'))).toBeDefined();
  });

  it('hands focus on when the focused pane is joined away', () => {
    const store = seed();
    store.focusNode(asNodeId('b'));
    expect(store.focusedId).toBe('b');
    const { seam } = mount(store);
    down(seam);
    const x = drag(seam, 145);
    up(seam, x);
    expect(store.getNode(asNodeId('b'))).toBeUndefined();
    expect(store.focusedId).not.toBe('b');
  });
});
