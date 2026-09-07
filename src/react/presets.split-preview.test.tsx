import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  asNodeId,
  type DragController,
  type NodeId,
  type Rect,
  Store,
  stripStrategy,
} from '../index.js';
import { DragProvider, useDragController } from './dnd/DragProvider.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(cleanup);

const Z = asNodeId('z');
const A = asNodeId('a');
const B = asNodeId('b');

function CaptureController({ into }: { into: (c: DragController) => void }) {
  into(useDragController());
  return null;
}

/** Horizontal strip `z` › panels `a`, `b`, the tree `<Container>`'s own split
 *  preview tests use — so the two paths are compared against one geometry. */
function tree(
  store: Store,
  capture: (c: DragController) => void,
  zoneProps: Record<string, unknown> = {},
) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <DragProvider>
          <CaptureController into={capture} />
          <Zone
            id={Z}
            strategyId="strip"
            config={{ axis: 'x', fill: true }}
            viewport={{ w: 200, h: 100 }}
            acceptsDrops
            splitOnDrop
            {...zoneProps}
          >
            <Panel id={A} />
            <Panel id={B} />
          </Zone>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/** jsdom lays nothing out, so every pane reports a zero box and every cursor
 *  lands in the same band. Stage the rects the strip would have produced. */
function stub(container: HTMLElement, rects: Record<string, Rect>): void {
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

const ROW: Record<string, Rect> = {
  z: { x: 0, y: 0, z: 0, w: 200, h: 100 },
  a: { x: 0, y: 0, z: 0, w: 100, h: 100 },
  b: { x: 100, y: 0, z: 0, w: 100, h: 100 },
};

/** The row once a `'layout'` split preview has moved it: `a` left the strip, so
 *  the group takes the whole box and `b` sits in the bottom half. */
const PREVIEWED: Record<string, Rect> = {
  z: { x: 0, y: 0, z: 0, w: 200, h: 100 },
  a: { x: 0, y: 0, z: 0, w: 200, h: 50 },
  b: { x: 0, y: 50, z: 0, w: 200, h: 50 },
};

/** Drag `a` and hold the cursor at a point, re-stubbing across the begin: the
 *  drag re-renders and a fresh element carries jsdom's zero box again. */
async function hover(
  c: DragController,
  container: HTMLElement,
  point: { x: number; y: number },
  rects: Record<string, Rect> = ROW,
): Promise<void> {
  stub(container, rects);
  c.tryBegin(A);
  await new Promise((r) => setTimeout(r, 20));
  stub(container, rects);
  c.updateHoverByPoint(point.x, point.y);
  await new Promise((r) => setTimeout(r, 20));
}

/** A preset pane's box is on the wrapper its parent placed, not on the shell
 *  carrying `data-node`. */
function paneBox(container: HTMLElement, id: NodeId) {
  const el = container.querySelector(`[data-node="${id}"]`)?.parentElement as HTMLElement | null;
  return el
    ? { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height }
    : null;
}

const previewEl = (c: HTMLElement) =>
  c.querySelector('.windease-split-preview') as HTMLElement | null;

describe('<Zone splitPreview>', () => {
  it("shrinks the onto-pane to its post-drop half under 'layout'", async () => {
    let controller!: DragController;
    const { container } = render(
      tree(new Store(), (c) => {
        controller = c;
      }),
    );

    await hover(controller, container, { x: 150, y: 5 });

    // `a` moves into the new group, so the group inherits `b`'s slot — which,
    // with `a` gone from the strip, is the whole 200×100 zone. `b` takes the
    // bottom half of it because the drop lands on the start edge.
    expect(paneBox(container, B)).toEqual({
      left: '0px',
      top: '50px',
      width: '200px',
      height: '50px',
    });
  });

  it("puts the dragged pane in the other half under 'layout'", async () => {
    let controller!: DragController;
    const { container } = render(
      tree(new Store(), (c) => {
        controller = c;
      }),
    );

    await hover(controller, container, { x: 150, y: 5 });

    expect(paneBox(container, A)).toEqual({
      left: '0px',
      top: '0px',
      width: '200px',
      height: '50px',
    });
    // The drawn element covers that half, not half the onto-pane.
    expect(previewEl(container)).toMatchObject({
      style: { left: '0px', top: '0px', width: '200px', height: '50px' },
    });
  });

  it('renders the dragged pane hidden while the ghost stands in for it', async () => {
    let controller!: DragController;
    const { container } = render(
      tree(new Store(), (c) => {
        controller = c;
      }),
    );

    await hover(controller, container, { x: 150, y: 5 });

    const wrapper = container.querySelector(`[data-node="${A}"]`)?.parentElement as HTMLElement;
    expect(wrapper.style.opacity).toBe('0');
    expect(wrapper.getAttribute('data-preview-source')).toBe('true');
  });

  it("leaves the onto-pane at full size and shades its near half under 'element'", async () => {
    let controller!: DragController;
    const { container } = render(
      tree(
        new Store(),
        (c) => {
          controller = c;
        },
        { splitPreview: 'element' },
      ),
    );

    await hover(controller, container, { x: 150, y: 5 });

    expect(paneBox(container, B)).toMatchObject({ top: '0px', height: '100px' });
    expect(previewEl(container)).toMatchObject({
      style: { left: '100px', top: '0px', width: '100px', height: '50px' },
    });
  });

  it("neither relayouts nor draws under 'none'", async () => {
    let controller!: DragController;
    const { container } = render(
      tree(
        new Store(),
        (c) => {
          controller = c;
        },
        { splitPreview: 'none' },
      ),
    );

    await hover(controller, container, { x: 150, y: 5 });

    expect(controller.state()?.hover?.intent).toMatchObject({ kind: 'split' });
    expect(previewEl(container)).toBeNull();
    expect(paneBox(container, B)).toMatchObject({ top: '0px', height: '100px' });
  });

  it('holds the split once the preview has moved the pane out from under the cursor', async () => {
    let controller!: DragController;
    const { container } = render(
      tree(new Store(), (c) => {
        controller = c;
      }),
    );

    await hover(controller, container, { x: 150, y: 5 });
    expect(controller.state()?.hover?.intent).toMatchObject({ kind: 'split', ontoId: 'b' });

    // The pane the cursor is over has shrunk to the bottom half, so a hit-test
    // against the live DOM now lands in the source's half and reads the drop as
    // an insert. The intent has to resolve against the un-displaced row.
    stub(container, PREVIEWED);
    controller.updateHoverByPoint(150, 5);
    await new Promise((r) => setTimeout(r, 20));

    expect(controller.state()?.hover?.intent).toMatchObject({
      kind: 'split',
      ontoId: 'b',
      edge: 'start',
    });
  });
});

describe('<Zone> insertion preview', () => {
  it('lays the row out as if the drop had happened', async () => {
    let controller!: DragController;
    const { container } = render(
      tree(new Store(), (c) => {
        controller = c;
      }),
    );

    // Right of `b`'s midpoint: `a` would land after it.
    await hover(controller, container, { x: 190, y: 50 });

    expect(controller.state()?.hover?.intent).toEqual({ kind: 'insert', index: 1 });
    expect(
      container.querySelector(`[data-node-container="${Z}"]`)?.getAttribute('data-preview'),
    ).toBe('true');
    expect(paneBox(container, B)).toMatchObject({ left: '0px' });
    expect(paneBox(container, A)).toMatchObject({ left: '100px' });
  });
});

describe('<Panel container> splitPreview', () => {
  it('previews a split in a layout a panel hosts', async () => {
    class RO {
      constructor(private cb: ResizeObserverCallback) {}
      observe(el: Element) {
        this.cb(
          [{ target: el, contentRect: { width: 200, height: 100 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', RO);

    const store = new Store();
    const HOST = asNodeId('host');
    let controller!: DragController;
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <DragProvider>
            <CaptureController
              into={(c) => {
                controller = c;
              }}
            />
            <Zone
              id={Z}
              strategyId="strip"
              config={{ axis: 'y', fill: true }}
              viewport={{ w: 200, h: 100 }}
            >
              <Panel
                id={HOST}
                container={{ strategyId: 'strip', config: { axis: 'x', fill: true } }}
                acceptsDrops
                splitOnDrop
              >
                <Panel id={A} />
                <Panel id={B} />
              </Panel>
            </Zone>
          </DragProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );

    await hover(controller, container, { x: 150, y: 5 }, { ...ROW, host: ROW.z as Rect });

    expect(controller.state()?.hover?.intent).toMatchObject({ kind: 'split', ontoId: 'b' });
    expect(paneBox(container, B)).toEqual({
      left: '0px',
      top: '50px',
      width: '200px',
      height: '50px',
    });
    vi.unstubAllGlobals();
  });
});
