import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asNodeId,
  createNode,
  type DragController,
  type DropIntent,
  type Rect,
  Store,
  stripStrategy,
} from '../index.js';
import { Container, type DropIntentContext } from './Container.js';
import { DragProvider, useDragController } from './dnd/DragProvider.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

const Z = asNodeId('z');

/** Horizontal strip `z` › panels `a`, `b`. `fill` because strip's own default
 *  sizes hintless children to zero, which would place both panes at 0×0. */
function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
      id: Z,
    }),
  );
  s.showNode(Z);
  for (const c of ['a', 'b']) {
    const nid = asNodeId(c);
    s.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: Z }));
    s.showNode(nid);
  }
  return s;
}

function CaptureController({ into }: { into: (c: DragController) => void }) {
  into(useDragController());
  return null;
}

interface TreeProps {
  store: Store;
  capture: (c: DragController) => void;
  splitOnDrop?: boolean;
  stackOnDrop?: boolean;
  splitPreview?: 'none' | 'element' | 'layout';
  dropIntent?: (ctx: DropIntentContext) => DropIntent | undefined;
}

function tree({ store, capture, splitOnDrop, stackOnDrop, splitPreview, dropIntent }: TreeProps) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <DragProvider>
          <CaptureController into={capture} />
          <Container
            parentId={Z}
            chrome={{}}
            viewport={{ w: 200, h: 100 }}
            {...(splitOnDrop ? { splitOnDrop } : {})}
            {...(stackOnDrop ? { stackOnDrop } : {})}
            {...(splitPreview ? { splitPreview } : {})}
            {...(dropIntent ? { dropIntent } : {})}
          />
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/**
 * jsdom lays nothing out, so `childRectsForContainer` would read a row of
 * zero-sized boxes and every cursor would land in the same band. Give the two
 * panes the 100×100 halves the strip would have produced.
 */
function stubRects(container: HTMLElement): void {
  const rects: Record<string, Rect> = {
    a: { x: 0, y: 0, w: 100, h: 100 },
    b: { x: 100, y: 0, w: 100, h: 100 },
  };
  for (const el of Array.from(container.querySelectorAll('[data-node]'))) {
    const id = el.getAttribute('data-node');
    const r = id ? rects[id] : undefined;
    if (!r) continue;
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
  const box = container.querySelector('[data-node-container]');
  if (box) {
    box.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  }
}

/**
 * Re-stub the panes at the geometry a `'layout'` split preview produces: `a`
 * leaves the row so the group takes the whole box, source in the top half.
 * jsdom lays nothing out, so the displacement the real DOM performs has to be
 * staged by hand.
 */
function stubPreviewedRects(container: HTMLElement): void {
  const rects: Record<string, Rect> = {
    a: { x: 0, y: 0, w: 200, h: 50 },
    b: { x: 0, y: 50, w: 200, h: 50 },
  };
  for (const el of Array.from(container.querySelectorAll('[data-node]'))) {
    const id = el.getAttribute('data-node');
    const r = id ? rects[id] : undefined;
    if (!r) continue;
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
}

/** Drag `a` and hover a point inside `b`, letting the drop target register. */
async function hover(
  c: DragController,
  container: HTMLElement,
  point: { x: number; y: number },
): Promise<void> {
  stubRects(container);
  c.tryBegin(asNodeId('a'));
  await new Promise((r) => setTimeout(r, 20));
  stubRects(container);
  c.updateHoverByPoint(point.x, point.y);
  await new Promise((r) => setTimeout(r, 20));
}

describe('<Container> drop intent', () => {
  it('resolves a split in a cross-axis band when splitOnDrop is set', async () => {
    const store = makeStore();
    let controller!: DragController;
    const { container } = render(
      tree({
        store,
        splitOnDrop: true,
        capture: (c) => {
          controller = c;
        },
      }),
    );

    // y=5 is the top band of `b`, whose rect is x 100..200.
    await hover(controller, container, { x: 150, y: 5 });

    expect(controller.state()?.hover?.intent).toEqual({
      kind: 'split',
      ontoId: 'b',
      edge: 'start',
      axis: 'y',
    });
  });

  it('resolves an insert in the same band when splitOnDrop is not set', async () => {
    const store = makeStore();
    let controller!: DragController;
    const { container } = render(
      tree({
        store,
        capture: (c) => {
          controller = c;
        },
      }),
    );

    await hover(controller, container, { x: 150, y: 5 });

    expect(controller.state()?.hover?.intent).toMatchObject({ kind: 'insert' });
  });

  it('uses a dropIntent prop instead of the built-in resolver', async () => {
    const store = makeStore();
    let controller!: DragController;
    const calls: DropIntentContext[] = [];
    const { container } = render(
      tree({
        store,
        splitOnDrop: true,
        dropIntent: (ctx) => {
          calls.push(ctx);
          return { kind: 'insert', index: 0 };
        },
        capture: (c) => {
          controller = c;
        },
      }),
    );

    await hover(controller, container, { x: 150, y: 5 });

    expect(calls.length).toBeGreaterThan(0);
    const last = calls.at(-1) as DropIntentContext;
    expect(last.axis).toBe('x');
    expect(last.sourceId).toBe(asNodeId('a'));
    // The dragged node is filtered out before the resolver sees the row.
    expect(last.rects.map((r) => r.id)).toEqual(['b']);
    // The built-in would have said `split` here; the prop's answer wins.
    expect(controller.state()?.hover?.intent).toEqual({ kind: 'insert', index: 0 });
  });
});

describe('<Container splitPreview>', () => {
  const preview = (container: HTMLElement) =>
    container.querySelector('.windease-split-preview') as HTMLElement | null;
  const paneStyle = (container: HTMLElement, id: string) => {
    const el = container.querySelector(`[data-node="${id}"]`) as HTMLElement | null;
    return el
      ? { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height }
      : null;
  };

  it("draws over the near half of the un-shrunk pane under 'element'", async () => {
    const store = makeStore();
    let controller!: DragController;
    const { container } = render(
      tree({
        store,
        splitOnDrop: true,
        splitPreview: 'element',
        capture: (c) => {
          controller = c;
        },
      }),
    );

    await hover(controller, container, { x: 150, y: 5 });

    const el = preview(container);
    expect(el).not.toBeNull();
    // `b` is placed at x 100..200 across the full 100 height; a 'y' split takes
    // the top half of it.
    expect(el?.style.left).toBe('100px');
    expect(el?.style.width).toBe('100px');
    expect(el?.style.top).toBe('0px');
    expect(el?.style.height).toBe('50px');
  });

  it("draws over the far half for an end-edge intent under 'element'", async () => {
    const store = makeStore();
    let controller!: DragController;
    const { container } = render(
      tree({
        store,
        splitOnDrop: true,
        splitPreview: 'element',
        capture: (c) => {
          controller = c;
        },
      }),
    );

    await hover(controller, container, { x: 150, y: 95 });

    expect(preview(container)?.style.top).toBe('50px');
    expect(preview(container)?.style.height).toBe('50px');
  });

  it("leaves the onto-pane at full size under 'element'", async () => {
    const store = makeStore();
    let controller!: DragController;
    const { container } = render(
      tree({
        store,
        splitOnDrop: true,
        splitPreview: 'element',
        capture: (c) => {
          controller = c;
        },
      }),
    );

    await hover(controller, container, { x: 150, y: 5 });

    expect(paneStyle(container, 'b')).toMatchObject({ top: '0px', height: '100px' });
  });

  it("shrinks the onto-pane to its post-drop half under 'layout'", async () => {
    const store = makeStore();
    let controller!: DragController;
    const { container } = render(
      tree({
        store,
        splitOnDrop: true,
        capture: (c) => {
          controller = c;
        },
      }),
    );

    await hover(controller, container, { x: 150, y: 5 });

    // `a` moves into the new group, so the group inherits `b`'s slot — which,
    // with `a` gone from the parent, is the whole 200x100 container. `b` takes
    // the bottom half of it because the drop lands on the start edge.
    expect(paneStyle(container, 'b')).toEqual({
      left: '0px',
      top: '50px',
      width: '200px',
      height: '50px',
    });
  });

  it("puts the dragged node in the other half under 'layout'", async () => {
    const store = makeStore();
    let controller!: DragController;
    const { container } = render(
      tree({
        store,
        splitOnDrop: true,
        capture: (c) => {
          controller = c;
        },
      }),
    );

    await hover(controller, container, { x: 150, y: 5 });

    expect(paneStyle(container, 'a')).toEqual({
      left: '0px',
      top: '0px',
      width: '200px',
      height: '50px',
    });
    // The drawn element covers that half rather than half the onto-pane.
    expect(preview(container)).toMatchObject({
      style: { left: '0px', top: '0px', width: '200px', height: '50px' },
    });
  });

  it("swaps which half each pane takes on an end-edge intent under 'layout'", async () => {
    const store = makeStore();
    let controller!: DragController;
    const { container } = render(
      tree({
        store,
        splitOnDrop: true,
        capture: (c) => {
          controller = c;
        },
      }),
    );

    await hover(controller, container, { x: 150, y: 95 });

    expect(paneStyle(container, 'b')).toMatchObject({ top: '0px', height: '50px' });
    expect(paneStyle(container, 'a')).toMatchObject({ top: '50px', height: '50px' });
  });

  it('holds the split once the preview has moved the pane out from under the cursor', async () => {
    const store = makeStore();
    let controller!: DragController;
    const { container } = render(
      tree({
        store,
        splitOnDrop: true,
        capture: (c) => {
          controller = c;
        },
      }),
    );

    await hover(controller, container, { x: 150, y: 5 });
    expect(controller.state()?.hover?.intent).toMatchObject({ kind: 'split', ontoId: 'b' });

    // The pane the cursor is over has shrunk to the bottom half, so a hit-test
    // against the live DOM now lands in the source's half and reads the drop
    // as an insert. The intent has to resolve against the un-displaced row.
    stubPreviewedRects(container);
    controller.updateHoverByPoint(150, 5);
    await new Promise((r) => setTimeout(r, 20));

    expect(controller.state()?.hover?.intent).toMatchObject({
      kind: 'split',
      ontoId: 'b',
      edge: 'start',
    });
  });

  it('draws nothing when splitPreview is none', async () => {
    const store = makeStore();
    let controller!: DragController;
    const { container } = render(
      tree({
        store,
        splitOnDrop: true,
        splitPreview: 'none',
        capture: (c) => {
          controller = c;
        },
      }),
    );

    await hover(controller, container, { x: 150, y: 5 });

    expect(controller.state()?.hover?.intent).toMatchObject({ kind: 'split' });
    expect(preview(container)).toBeNull();
  });

  it('draws nothing for an insert hover', async () => {
    const store = makeStore();
    let controller!: DragController;
    const { container } = render(
      tree({
        store,
        splitOnDrop: true,
        capture: (c) => {
          controller = c;
        },
      }),
    );

    // Centre of `b`: no stacking, so the centre falls through to an insert.
    await hover(controller, container, { x: 150, y: 50 });

    expect(preview(container)).toBeNull();
  });

  // The discriminating case for the intent-kind check. An insert carries no
  // `ontoId`, so it draws nothing whether or not the kind is tested; a stack
  // carries one, and without the check would draw a split preview over it.
  it('draws nothing for a stack hover, which also names an onto-child', async () => {
    const store = makeStore();
    let controller!: DragController;
    const { container } = render(
      tree({
        store,
        splitOnDrop: true,
        stackOnDrop: true,
        capture: (c) => {
          controller = c;
        },
      }),
    );

    await hover(controller, container, { x: 150, y: 50 });

    expect(controller.state()?.hover?.intent).toMatchObject({ kind: 'stack', ontoId: 'b' });
    expect(preview(container)).toBeNull();
  });
});
