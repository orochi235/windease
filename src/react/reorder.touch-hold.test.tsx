import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asNodeId,
  createNode,
  type DragController,
  Store,
  stripStrategy,
  TOUCH_HOLD_DELAY,
  TOUCH_HOLD_SLOP,
} from '../index.js';
import { Container } from './Container.js';
import { DragHandle } from './dnd/DragHandle.js';
import { DragProvider, useDragController } from './dnd/DragProvider.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

const Z = asNodeId('z');

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function makeStore(touchScroll: unknown): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: Z,
      container: {
        strategyId: 'strip',
        config: { axis: 'y', fill: true, reorder: true, touchScroll },
      },
    }),
  );
  s.showNode(Z);
  for (const c of ['a', 'b']) {
    const nid = asNodeId(c);
    s.registerNode(createNode({ kind: 'panel', id: nid, parentId: Z }));
    s.showNode(nid);
  }
  return s;
}

function tree(touchScroll: unknown = 'hold', touchHold?: { delay?: number; slop?: number }) {
  let controller!: DragController;
  function Capture() {
    controller = useDragController();
    return null;
  }
  const utils = render(
    <Provider store={makeStore(touchScroll)}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <DragProvider dragOverlay={null} {...(touchHold ? { touchHold } : {})}>
          <Capture />
          <Container
            parentId={Z}
            chrome={{ panel: ({ node }) => <span data-testid={`row-${node.id}`}>{node.id}</span> }}
            viewport={{ w: 100, h: 200 }}
          />
          <DragHandle nodeId={asNodeId('b')} touchScroll="hold">
            <span data-testid="grip">grip</span>
          </DragHandle>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>,
  );
  return { ...utils, controller: () => controller };
}

function down(el: Element, pointerType: string, x = 10, y = 10): void {
  act(() => {
    fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1, button: 0, pointerType });
  });
}

function move(x: number, y: number): void {
  act(() => {
    fireEvent.pointerMove(window, { clientX: x, clientY: y, pointerId: 1 });
  });
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function up(x = 10, y = 10): void {
  act(() => {
    fireEvent.pointerUp(window, { clientX: x, clientY: y, pointerId: 1 });
  });
}

/** Whether a cancelable `touchmove` dispatched now has its default prevented. */
function touchMoveBlocked(): boolean {
  const e = new Event('touchmove', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

describe("touchScroll: 'hold'", () => {
  it('leaves the wrapper its touch-action and marks it as a hold source', () => {
    const { getByTestId } = tree();
    const wrapper = getByTestId('row-a').closest('[data-windease-reorder]') as HTMLElement;
    expect(wrapper.style.touchAction).toBe('');
    expect(wrapper.getAttribute('data-windease-touch-scroll')).toBe('hold');
    const handle = getByTestId('grip').parentElement as HTMLElement;
    expect(handle.style.touchAction).toBe('');
    expect(handle.getAttribute('data-windease-touch-scroll')).toBe('hold');
  });

  it('starts a touch drag once the press holds still, then follows the finger', () => {
    const { getByTestId, controller } = tree();
    down(getByTestId('row-a'), 'touch');
    move(10 + TOUCH_HOLD_SLOP / 2, 10);
    wait(TOUCH_HOLD_DELAY - 1);
    expect(controller().state()).toBeNull();
    expect(touchMoveBlocked()).toBe(false);
    wait(1);
    expect(controller().state()?.draggingId).toBe('a');
    expect(touchMoveBlocked()).toBe(true);
    move(10, 150);
    wait(20);
    expect(controller().state()?.cursor).toEqual({ x: 10, y: 150 });
    up(10, 150);
    expect(controller().state()).toBeNull();
    expect(touchMoveBlocked()).toBe(false);
  });

  it('a swipe past the slop before the delay is left to the page and never drags', () => {
    const { getByTestId, controller } = tree();
    down(getByTestId('row-a'), 'touch');
    move(10, 10 + TOUCH_HOLD_SLOP + 4);
    wait(TOUCH_HOLD_DELAY * 2);
    expect(controller().state()).toBeNull();
    expect(touchMoveBlocked()).toBe(false);
    up();
  });

  it('a tap before the delay stays a click', () => {
    const { getByTestId, controller } = tree();
    down(getByTestId('row-a'), 'touch');
    up();
    wait(TOUCH_HOLD_DELAY);
    expect(controller().state()).toBeNull();
  });

  it('the browser taking the pointer cancels the pending hold', () => {
    const { getByTestId, controller } = tree();
    down(getByTestId('row-a'), 'touch');
    act(() => {
      fireEvent.pointerCancel(window, { pointerId: 1 });
    });
    wait(TOUCH_HOLD_DELAY);
    expect(controller().state()).toBeNull();
  });

  it('holds back the long-press context menu while the press is tracked', () => {
    const { getByTestId } = tree();
    down(getByTestId('row-a'), 'touch');
    const menu = new Event('contextmenu', { cancelable: true });
    window.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    up();
    const after = new Event('contextmenu', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('a mouse still drags on travel, with no hold', () => {
    const { getByTestId, controller } = tree();
    down(getByTestId('row-a'), 'mouse');
    move(10, 30);
    expect(controller().state()?.draggingId).toBe('a');
    up(10, 30);
  });

  it('a DragHandle with touchScroll="hold" waits out the hold too', () => {
    const { getByTestId, controller } = tree();
    down(getByTestId('grip'), 'touch');
    move(10, 30);
    expect(controller().state()).toBeNull();
    up();
    down(getByTestId('grip'), 'touch');
    wait(TOUCH_HOLD_DELAY);
    expect(controller().state()?.draggingId).toBe('b');
    up();
  });

  it('touchScroll: true keeps the travel threshold, with no hold', () => {
    const { getByTestId, controller } = tree(true);
    down(getByTestId('row-a'), 'touch');
    move(10, 30);
    expect(controller().state()?.draggingId).toBe('a');
    up(10, 30);
  });

  it("takes the DragProvider's touchHold delay and slop for a reorder child", () => {
    const { getByTestId, controller } = tree('hold', { delay: 100, slop: 30 });
    down(getByTestId('row-a'), 'touch');
    move(10 + 20, 10);
    wait(99);
    expect(controller().state()).toBeNull();
    wait(1);
    expect(controller().state()?.draggingId).toBe('a');
    up();
  });

  it("takes the DragProvider's touchHold for a DragHandle too", () => {
    const { getByTestId, controller } = tree('hold', { delay: 100, slop: 2 });
    down(getByTestId('grip'), 'touch');
    move(10 + 4, 10);
    wait(TOUCH_HOLD_DELAY + 50);
    expect(controller().state()).toBeNull();
    up();
  });
});
