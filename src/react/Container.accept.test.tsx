import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AcceptContext,
  asNodeId,
  createNode,
  type DragController,
  type EdgeScrollOptions,
  type Rect,
  Store,
  stripStrategy,
} from '../index.js';
import { Container } from './Container.js';
import { DragProvider, useDragController } from './dnd/DragProvider.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

const Z = asNodeId('z');
const OTHER = asNodeId('other');
const SOURCE = asNodeId('p');

/**
 * Strip `z` capped at two children, beside a zone holding the dragged panel
 * `p`. Two children and the strategy refuses the drop on its own; one and it
 * accepts — which is what tells a prop's verdict apart from the fixture's.
 */
function makeStore(childIds: string[]): Store {
  const s = new Store();
  for (const z of [Z, OTHER]) {
    s.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'x', fill: true, maxItems: 2 } },
        id: z,
      }),
    );
    s.showNode(z);
  }
  for (const c of childIds) {
    const nid = asNodeId(c);
    s.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: Z }));
    s.showNode(nid);
  }
  s.registerNode(createNode({ kind: 'panel', focus: true, id: SOURCE, parentId: OTHER }));
  s.showNode(SOURCE);
  return s;
}

function CaptureController({ into }: { into: (c: DragController) => void }) {
  into(useDragController());
  return null;
}

interface TreeProps {
  store: Store;
  capture: (c: DragController) => void;
  acceptPolicy?: (ctx: AcceptContext) => boolean | undefined;
}

function tree({ store, capture, acceptPolicy }: TreeProps) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <DragProvider>
          <CaptureController into={capture} />
          <Container
            parentId={Z}
            chrome={{}}
            viewport={{ w: 200, h: 100 }}
            {...(acceptPolicy ? { acceptPolicy } : {})}
          />
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/** jsdom lays nothing out, so every box a hit-test reads has to be staged by
 *  hand or the cursor lands on no target at all. */
function stubBox(el: Element, r: Rect): void {
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

function stubRects(container: HTMLElement): void {
  const box = container.querySelector('[data-node-container]');
  if (box) stubBox(box, { x: 0, y: 0, w: 200, h: 100 });
  const kids = Array.from(container.querySelectorAll('[data-node]'));
  kids.forEach((el, i) => {
    const w = 200 / Math.max(1, kids.length);
    stubBox(el, { x: i * w, y: 0, w, h: 100 });
  });
}

/** Drag `p` in from the other zone and hover the middle of `z`. */
async function hover(c: DragController, container: HTMLElement): Promise<void> {
  stubRects(container);
  c.tryBegin(SOURCE);
  await new Promise((r) => setTimeout(r, 20));
  stubRects(container);
  c.updateHoverByPoint(100, 50);
  await new Promise((r) => setTimeout(r, 20));
}

function mount(store: Store, acceptPolicy?: (ctx: AcceptContext) => boolean | undefined) {
  let controller!: DragController;
  const { container } = render(
    tree({
      store,
      ...(acceptPolicy ? { acceptPolicy } : {}),
      capture: (c) => {
        controller = c;
      },
    }),
  );
  return { container, controller: () => controller };
}

describe('<Container acceptPolicy>', () => {
  it('leaves the strategy in charge when unset', async () => {
    const { container, controller } = mount(makeStore(['a', 'b']));

    await hover(controller(), container);

    expect(controller().state()?.hover?.targetId).toBe(Z);
    expect(controller().state()?.hover?.accepted).toBe(false);
  });

  it('accepts where the strategy would refuse', async () => {
    const { container, controller } = mount(makeStore(['a', 'b']), () => true);

    await hover(controller(), container);

    expect(controller().state()?.hover?.accepted).toBe(true);
  });

  it('refuses where the strategy would accept', async () => {
    const { container, controller } = mount(makeStore(['a']), () => false);

    await hover(controller(), container);

    expect(controller().state()?.hover?.accepted).toBe(false);
  });

  it('defers to the strategy when it returns undefined', async () => {
    let calls = 0;
    const { container, controller } = mount(makeStore(['a', 'b']), () => {
      calls += 1;
      return undefined;
    });

    await hover(controller(), container);

    expect(calls).toBeGreaterThan(0);
    expect(controller().state()?.hover?.accepted).toBe(false);
  });

  it('is asked about the post-drop child list and the container config', async () => {
    const seen: AcceptContext[] = [];
    const { container, controller } = mount(makeStore(['a', 'b']), (ctx) => {
      seen.push(ctx);
      return true;
    });

    await hover(controller(), container);

    const last = seen.at(-1) as AcceptContext;
    expect(last.items).toHaveLength(3);
    expect(last.items.map((i) => i.id)).toEqual(['a', 'b', SOURCE]);
    expect(last.options.maxItems).toBe(2);
    expect(last.sourceId).toBe(SOURCE);
  });
});

/** The scrolling wrapper `<Container>` is told about, so a drag held near its
 *  edge has something to scroll. */
function Scrolling({ edgeScroll }: { edgeScroll?: EdgeScrollOptions }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={scrollRef} data-testid="scroller">
      <Container
        parentId={Z}
        chrome={{}}
        viewport={{ w: 200, h: 100 }}
        scrollRef={scrollRef}
        {...(edgeScroll ? { edgeScroll } : {})}
      />
    </div>
  );
}

function scrollTree({
  store,
  capture,
  edgeScroll,
}: TreeProps & { edgeScroll?: EdgeScrollOptions }) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <DragProvider>
          <CaptureController into={capture} />
          <Scrolling {...(edgeScroll ? { edgeScroll } : {})} />
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/** jsdom's own `scrollLeft` setter drops the write, so the box records it. */
function recordScrollLeft(el: HTMLElement): () => number {
  let left = 0;
  Object.defineProperty(el, 'scrollLeft', {
    get: () => left,
    set: (v: number) => {
      left = v;
    },
    configurable: true,
  });
  return () => left;
}

function mountScrolling(edgeScroll?: EdgeScrollOptions) {
  let controller!: DragController;
  const { container, getByTestId } = render(
    scrollTree({
      store: makeStore(['a']),
      ...(edgeScroll ? { edgeScroll } : {}),
      capture: (c) => {
        controller = c;
      },
    }),
  );
  const scroller = getByTestId('scroller');
  stubRects(container);
  stubBox(scroller, { x: 0, y: 0, w: 200, h: 100 });
  return { container, controller: () => controller, read: recordScrollLeft(scroller) };
}

/** Hold the drag against the right edge of the scrolling box. */
async function hoverEdge(c: DragController, container: HTMLElement): Promise<void> {
  c.tryBegin(SOURCE);
  await new Promise((r) => setTimeout(r, 20));
  stubRects(container);
  c.updateHoverByPoint(198, 50);
  await new Promise((r) => setTimeout(r, 20));
}

// Whether the ramp feels right under a real pointer is browser work; these pin
// only that the prop reaches the engine's scroll bag.
describe('<Container edgeScroll>', () => {
  it('scrolls the box a drag is held at the edge of', async () => {
    const { container, controller, read } = mountScrolling();

    await hoverEdge(controller(), container);
    controller().cancel();

    expect(read()).toBeGreaterThan(0);
  });

  it('takes a ramp that says never to scroll', async () => {
    const { container, controller, read } = mountScrolling({ maxRate: 0 });

    await hoverEdge(controller(), container);
    controller().cancel();

    expect(read()).toBe(0);
  });
});

const STRIP = { strip: stripStrategy as never };

/** `z` a strip capped at two panes, already full with `a`/`b`; `other` holds
 *  the panel `p` to be dragged in — the same discipline as `makeStore`. */
function zoneTree(
  store: Store,
  capture: (c: DragController) => void,
  acceptPolicy?: (ctx: AcceptContext) => boolean | undefined,
) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRIP}>
        <DragProvider>
          <CaptureController into={capture} />
          <Zone
            id={Z}
            strategyId="strip"
            config={{ axis: 'x', fill: true, maxItems: 2 }}
            viewport={{ w: 200, h: 100 }}
            acceptsDrops
            {...(acceptPolicy ? { acceptPolicy } : {})}
          >
            <Panel id={asNodeId('a')} />
            <Panel id={asNodeId('b')} />
          </Zone>
          <Zone id={OTHER} strategyId="strip" config={{ axis: 'x', fill: true }}>
            <Panel id={SOURCE} />
          </Zone>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

function stubZoneRects(container: HTMLElement): void {
  const rects: Record<string, Rect> = {
    z: { x: 0, y: 0, w: 200, h: 100 },
    a: { x: 0, y: 0, w: 100, h: 100 },
    b: { x: 100, y: 0, w: 100, h: 100 },
    other: { x: 0, y: 200, w: 200, h: 100 },
    p: { x: 0, y: 200, w: 200, h: 100 },
  };
  for (const el of Array.from(container.querySelectorAll('[data-node]'))) {
    const id = el.getAttribute('data-node');
    const r = id ? rects[id] : undefined;
    if (r) stubBox(el, r);
  }
}

async function hoverZone(c: DragController, container: HTMLElement): Promise<void> {
  stubZoneRects(container);
  c.tryBegin(SOURCE);
  await new Promise((r) => setTimeout(r, 20));
  stubZoneRects(container);
  c.updateHoverByPoint(100, 50);
  await new Promise((r) => setTimeout(r, 20));
}

function mountZone(store: Store, acceptPolicy?: (ctx: AcceptContext) => boolean | undefined) {
  let controller!: DragController;
  const { container } = render(
    zoneTree(
      store,
      (c) => {
        controller = c;
      },
      acceptPolicy,
    ),
  );
  return { container, controller: () => controller };
}

describe('<Zone acceptPolicy>', () => {
  it('rejects a further drop at the strategy cap when unset', async () => {
    const { container, controller } = mountZone(new Store());

    await hoverZone(controller(), container);

    expect(controller().state()?.hover?.accepted).toBe(false);
  });

  it('accepts where the strategy would refuse', async () => {
    const { container, controller } = mountZone(new Store(), () => true);

    await hoverZone(controller(), container);

    expect(controller().state()?.hover?.accepted).toBe(true);
  });

  it('is asked about the post-drop child list and the container config', async () => {
    const seen: AcceptContext[] = [];
    const { container, controller } = mountZone(new Store(), (ctx) => {
      seen.push(ctx);
      return true;
    });

    await hoverZone(controller(), container);

    expect(seen.length).toBeGreaterThan(0);
    const last = seen.at(-1) as AcceptContext;
    expect(last.items.map((i) => i.id)).toEqual(['a', 'b', SOURCE]);
    expect(last.options.maxItems).toBe(2);
    expect(last.sourceId).toBe(SOURCE);
  });
});
