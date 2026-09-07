import { cleanup, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asNodeId,
  type DragController,
  type EdgeScrollOptions,
  type Rect,
  Store,
  stripStrategy,
} from '../index.js';
import { DragProvider, useDragController } from './dnd/DragProvider.js';
import {
  GeometryProvider,
  type GeometryRegistry,
  useGeometryRegistry,
} from './focus/useGeometrySource.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

const Z = asNodeId('z');
const A = asNodeId('a');
const B = asNodeId('b');

let captured: GeometryRegistry | null = null;
function CaptureRegistry() {
  captured = useGeometryRegistry();
  return null;
}

function CaptureController({ into }: { into: (c: DragController) => void }) {
  into(useDragController());
  return null;
}

/** A vertical strip in a wrapper the consumer scrolls — the arrangement
 *  `<Container scrollRef>` documents, built from presets. */
function Scrolling({ edgeScroll }: { edgeScroll?: EdgeScrollOptions }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={scrollRef} data-testid="scroller">
      <Zone
        id={Z}
        strategyId="strip"
        config={{ axis: 'y', fill: true }}
        viewport={{ w: 200, h: 100 }}
        acceptsDrops
        scrollRef={scrollRef}
        {...(edgeScroll ? { edgeScroll } : {})}
      >
        <Panel id={A} />
        <Panel id={B} />
      </Zone>
    </div>
  );
}

function tree(store: Store, opts: { edgeScroll?: EdgeScrollOptions } = {}) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <GeometryProvider>
          <CaptureRegistry />
          <Scrolling {...opts} />
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

function dragTree(
  store: Store,
  capture: (c: DragController) => void,
  opts: { edgeScroll?: EdgeScrollOptions } = {},
) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <DragProvider>
          <CaptureController into={capture} />
          <Scrolling {...opts} />
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

const rectOf = (id: string) => captured?.rects.get(id);

/** jsdom lays nothing out, so the box the ramp measures has to be staged. */
function stub(el: Element, r: Rect): void {
  el.getBoundingClientRect = () =>
    ({
      left: r.x,
      top: r.y,
      right: r.x + r.w,
      bottom: r.y + r.h,
      width: r.w,
      height: r.h,
      x: r.x,
      y: r.y,
      toJSON: () => ({}),
    }) as DOMRect;
}

function stubAll(container: HTMLElement, scroller: HTMLElement): void {
  stub(scroller, { x: 0, y: 0, z: 0, w: 200, h: 100 });
  const rects: Record<string, Rect> = {
    z: { x: 0, y: 0, z: 0, w: 200, h: 100 },
    a: { x: 0, y: 0, z: 0, w: 200, h: 50 },
    b: { x: 0, y: 50, z: 0, w: 200, h: 50 },
  };
  for (const el of Array.from(container.querySelectorAll('[data-node]'))) {
    const id = el.getAttribute('data-node');
    const r = id ? rects[id] : undefined;
    if (r) stub(el, r);
  }
}

/** Pick `a` up and hold the cursor at a point, re-stubbing across the begin:
 *  the drag re-renders and a fresh element carries jsdom's zero box again. */
async function holdAt(
  c: DragController,
  container: HTMLElement,
  scroller: HTMLElement,
  point: { x: number; y: number },
): Promise<void> {
  stubAll(container, scroller);
  c.tryBegin(A);
  await new Promise((r) => setTimeout(r, 20));
  stubAll(container, scroller);
  c.updateHoverByPoint(point.x, point.y);
  await new Promise((r) => setTimeout(r, 20));
}

describe('<Zone scrollRef> — geometry under scroll', () => {
  it('shifts a pane by the scroll offset, so navigation sees where it is', async () => {
    const { getByTestId } = render(tree(new Store()));
    await waitFor(() => expect(rectOf('a')).toBeDefined());
    expect(rectOf('a')?.y).toBe(0);

    const scroller = getByTestId('scroller');
    scroller.scrollTop = 40;
    scroller.dispatchEvent(new Event('scroll'));

    await waitFor(() => expect(rectOf('a')?.y).toBe(-40));
    expect(rectOf('b')?.y).toBe(10);
  });
});

describe('<Zone scrollRef> — edge scroll', () => {
  it('scrolls the wrapper while a drag is held at its edge', async () => {
    let controller!: DragController;
    const { container, getByTestId } = render(
      dragTree(new Store(), (c) => {
        controller = c;
      }),
    );
    const scroller = getByTestId('scroller');

    await holdAt(controller, container, scroller, { x: 100, y: 98 });

    expect(scroller.scrollTop).toBeGreaterThan(0);
  });

  it('leaves it alone for a cursor the ramp does not reach', async () => {
    let controller!: DragController;
    const { container, getByTestId } = render(
      dragTree(new Store(), (c) => {
        controller = c;
      }),
    );
    const scroller = getByTestId('scroller');

    await holdAt(controller, container, scroller, { x: 100, y: 50 });

    expect(scroller.scrollTop).toBe(0);
  });

  it('honors the ramp the zone declared', async () => {
    let controller!: DragController;
    const { container, getByTestId } = render(
      dragTree(
        new Store(),
        (c) => {
          controller = c;
        },
        { edgeScroll: { maxRate: 0 } },
      ),
    );
    const scroller = getByTestId('scroller');

    await holdAt(controller, container, scroller, { x: 100, y: 98 });

    expect(scroller.scrollTop).toBe(0);
  });
});
