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

/** One pointermove of `delta`, the way a fast drag actually arrives. Returns
 *  the clientX it left the pointer at. */
function move(seam: HTMLElement, delta: number, from = 0): number {
  const x = from + delta;
  fireEvent.pointerMove(seam, { pointerId: 1, clientX: x, clientY: 0 });
  return x;
}

/** Travel that takes `a` to its 320px ceiling, leaving the seam pinned. */
const TO_CLAMP = 145;

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
    const x = move(seam, 60);
    expect(armedPane(container)).toBeNull();
    up(seam, x);
    expect(store.getNode(asNodeId('b'))).toBeDefined();
  });

  // A fast drag asks for far more than the seam can absorb in one move. The
  // seam was not pinned when the move arrived, so none of it is overshoot.
  it('a single large move from rest does not arm, however far it travels', () => {
    const { container, seam } = mount(store);
    down(seam);
    const x = move(seam, TO_CLAMP);
    expect(armedPane(container)).toBeNull();
    expect(widthOf(store, 'a')).toBe(320);
    up(seam, x);
    expect(store.getNode(asNodeId('b'))).toBeDefined();
  });

  it('pushing past the floor by more than the threshold arms the victim', () => {
    const { container, seam } = mount(store);
    down(seam);
    const x = move(seam, TO_CLAMP);
    move(seam, 30, x);
    expect(armedPane(container)).toBe('b');
    expect(container.querySelector('[data-affordance-hit][data-join-armed]')).not.toBeNull();
  });

  it('releasing while armed destroys the victim and leaves its siblings', () => {
    const { seam } = mount(store);
    down(seam);
    const x = move(seam, 30, move(seam, TO_CLAMP));
    up(seam, x);
    expect(store.getNode(asNodeId('b'))).toBeUndefined();
    expect(store.getNode(asNodeId('a'))).toBeDefined();
    expect(store.getNode(asNodeId('c'))).toBeDefined();
  });

  it('backing off under the threshold disarms, and release keeps the pane', () => {
    const { container, seam } = mount(store);
    down(seam);
    let x = move(seam, 30, move(seam, TO_CLAMP));
    expect(armedPane(container)).toBe('b');
    x = move(seam, -10, x);
    expect(armedPane(container)).toBeNull();
    up(seam, x);
    expect(store.getNode(asNodeId('b'))).toBeDefined();
  });

  it('a destroy-locked pane never arms, but the resize still clamps against it', () => {
    const locked = seed(true);
    const { container, seam } = mount(locked);
    down(seam);
    const x = move(seam, 300, move(seam, TO_CLAMP));
    expect(armedPane(container)).toBeNull();
    up(seam, x);
    expect(locked.getNode(asNodeId('b'))).toBeDefined();
    expect(widthOf(locked, 'a')).toBe(320);
  });

  // Backing off returns the pane above its floor; pushing again must re-earn
  // the overshoot against the clamp, not resume where the first push stopped.
  it('does not re-arm on a pane the seam has let back off its floor', () => {
    const { container, seam } = mount(store);
    down(seam);
    let x = move(seam, 30, move(seam, TO_CLAMP));
    expect(armedPane(container)).toBe('b');

    x = move(seam, -25, x);
    expect(armedPane(container)).toBeNull();
    expect(widthOf(store, 'a')).toBe(295);
    expect(widthOf(store, 'b')).toBe(105);

    x = move(seam, 20, x);
    expect(armedPane(container)).toBeNull();
    expect(widthOf(store, 'a')).toBe(315);
    expect(widthOf(store, 'b')).toBe(85);

    up(seam, x);
    expect(store.getNode(asNodeId('b'))).toBeDefined();
  });

  // The first gesture ends 20px past the floor — under the 24px threshold, but
  // enough that carrying it into the next gesture would arm on the first move.
  it('overshoot resets per gesture', () => {
    const { container, seam } = mount(store);
    down(seam);
    let x = move(seam, 20, move(seam, TO_CLAMP));
    expect(armedPane(container)).toBeNull();
    up(seam, x);
    down(seam, x);
    x = move(seam, 10, x);
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
    const x = move(seam, 30, move(seam, TO_CLAMP));
    expect(armedPane(container)).toBe('b');
    fireEvent.pointerCancel(seam, { pointerId: 1, clientX: x, clientY: 0 });
    expect(store.getNode(asNodeId('b'))).toBeDefined();
    expect(armedPane(container)).toBeNull();
  });

  it('Escape while armed does not destroy, and a later pointerup does not either', () => {
    const store = seed();
    const { container, seam } = mount(store);
    down(seam);
    const x = move(seam, 30, move(seam, TO_CLAMP));
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
    const x = move(seam, 30, move(seam, TO_CLAMP));
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
    const x = move(seam, 30, move(seam, TO_CLAMP));
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
    const x = move(seam, 30, move(seam, TO_CLAMP));
    up(seam, x);
    expect(store.getNode(asNodeId('b'))).toBeUndefined();
    expect(store.focusedId).not.toBe('b');
  });
});

/** ArrowRight presses at the default 8px `affordanceKeyStep`. Fifteen take `a`
 *  from 200 to its 320 ceiling — the last of them still reads the seam as
 *  unpinned, so the first press that counts as overshoot is the sixteenth, and
 *  four of those (32px) clear the 24px threshold. */
const KEYS_TO_CLAMP = 15;
const KEYS_TO_ARM = KEYS_TO_CLAMP + 4;

function press(seam: HTMLElement, key: string, times = 1): boolean {
  let notCanceled = true;
  for (let i = 0; i < times; i++) notCanceled = fireEvent.keyDown(seam, { key });
  return notCanceled;
}

function liveText(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('[data-join-live]'))
    .map((el) => el.textContent ?? '')
    .join('');
}

describe('seam join — from the keyboard', () => {
  let store: Store;
  beforeEach(() => {
    store = seed();
  });

  it('arrowing past the floor arms the victim', () => {
    const { container, seam } = mount(store);
    press(seam, 'ArrowRight', KEYS_TO_ARM - 1);
    expect(widthOf(store, 'a')).toBe(320);
    expect(armedPane(container)).toBeNull();
    press(seam, 'ArrowRight');
    expect(armedPane(container)).toBe('b');
  });

  it('Enter while armed destroys the victim and leaves its siblings', () => {
    const { container, seam } = mount(store);
    press(seam, 'ArrowRight', KEYS_TO_ARM);
    expect(armedPane(container)).toBe('b');
    expect(press(seam, 'Enter')).toBe(false);
    expect(store.getNode(asNodeId('b'))).toBeUndefined();
    expect(store.getNode(asNodeId('a'))).toBeDefined();
    expect(store.getNode(asNodeId('c'))).toBeDefined();
  });

  it('Enter while not armed does nothing and leaves the key to the host', () => {
    const { container, seam } = mount(store);
    press(seam, 'ArrowRight', 3);
    expect(armedPane(container)).toBeNull();
    expect(press(seam, 'Enter')).toBe(true);
    expect(store.getNode(asNodeId('b'))).toBeDefined();
    expect(widthOf(store, 'a')).toBe(224);
  });

  it('Escape disarms without destroying, and a later Enter does not either', () => {
    const { container, seam } = mount(store);
    press(seam, 'ArrowRight', KEYS_TO_ARM);
    expect(armedPane(container)).toBe('b');
    press(seam, 'Escape');
    expect(armedPane(container)).toBeNull();
    expect(store.getNode(asNodeId('b'))).toBeDefined();
    press(seam, 'Enter');
    expect(store.getNode(asNodeId('b'))).toBeDefined();
  });

  it('arrowing back disarms', () => {
    const { container, seam } = mount(store);
    press(seam, 'ArrowRight', KEYS_TO_ARM);
    expect(armedPane(container)).toBe('b');
    press(seam, 'ArrowLeft');
    expect(armedPane(container)).toBeNull();
    expect(widthOf(store, 'a')).toBe(312);
  });

  // End means "go to valueMax": the travel that gets there is unpinned and
  // cannot accumulate, and once there the delta is zero.
  it('End never arms however often it is pressed', () => {
    const { container, seam } = mount(store);
    press(seam, 'End', 5);
    expect(widthOf(store, 'a')).toBe(320);
    expect(armedPane(container)).toBeNull();
    expect(liveText(container)).toBe('');
    press(seam, 'Enter');
    expect(store.getNode(asNodeId('b'))).toBeDefined();
  });

  it('losing focus drops the accumulation', () => {
    const { container, seam } = mount(store);
    press(seam, 'ArrowRight', KEYS_TO_ARM);
    expect(armedPane(container)).toBe('b');
    fireEvent.blur(seam);
    expect(armedPane(container)).toBeNull();
    press(seam, 'ArrowRight', 2);
    expect(armedPane(container)).toBeNull();
    expect(store.getNode(asNodeId('b'))).toBeDefined();
  });

  it('announces the armed pane in a live region, and nothing when disarmed', () => {
    store.setMeta(asNodeId('b'), { title: 'Preview' });
    const { container, seam } = mount(store);
    const region = container.querySelector('[data-join-live]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(liveText(container)).toBe('');

    press(seam, 'ArrowRight', KEYS_TO_ARM);
    expect(liveText(container)).toBe(
      'Preview will close. Press Enter to confirm, Escape to cancel.',
    );

    press(seam, 'Escape');
    expect(liveText(container)).toBe('');
  });

  it('a destroy-locked pane never arms from the keyboard either', () => {
    const locked = seed(true);
    const { container, seam } = mount(locked);
    press(seam, 'ArrowRight', KEYS_TO_ARM + 6);
    expect(armedPane(container)).toBeNull();
    expect(liveText(container)).toBe('');
    press(seam, 'Enter');
    expect(locked.getNode(asNodeId('b'))).toBeDefined();
    expect(widthOf(locked, 'a')).toBe(320);
  });
});
