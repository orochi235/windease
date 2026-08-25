import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { childRectsForContainer } from '../dnd/insertionIndex.js';
import {
  asNodeId,
  createNode,
  type DragController,
  type Rect,
  Store,
  stripStrategy,
} from '../index.js';
import { DragProvider, useDragController } from './dnd/DragProvider.js';
import { Panel, Provider, StrategyRegistryProvider, Zone } from './index.js';

const STRATEGIES = { strip: stripStrategy as never };

afterEach(cleanup);

describe('preset DOM contract', () => {
  it('harvests a zone’s own panes, not its grandchildren', () => {
    const store = new Store();
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone
            id={asNodeId('outer')}
            strategyId="strip"
            config={{ axis: 'x', fill: true }}
            viewport={{ w: 200, h: 100 }}
          >
            <Panel id={asNodeId('a')} />
            <Zone id={asNodeId('inner')} strategyId="strip" config={{ axis: 'y', fill: true }}>
              <Panel id={asNodeId('deep')} />
            </Zone>
          </Zone>
        </StrategyRegistryProvider>
      </Provider>,
    );
    const outer = container.querySelector('[data-node="outer"]') as HTMLElement;
    expect(childRectsForContainer(outer).map((r) => r.id)).toEqual(['a', 'inner']);
  });
});

function CaptureController({ into }: { into: (c: DragController) => void }) {
  into(useDragController());
  return null;
}

/** jsdom lays nothing out, so every pane would report a zero box and every
 *  cursor would land in the same band. Give `a` and `b` the 100×100 halves the
 *  strip would have produced, and `z` the box that contains them — a target
 *  whose own rect is empty is never hovered. */
function stubRects(container: HTMLElement): void {
  const rects: Record<string, Rect> = {
    z: { x: 0, y: 0, w: 200, h: 100 },
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
}

function presetTree(
  store: Store,
  capture: (c: DragController) => void,
  extra: { stackOnDrop?: boolean; splitOnDrop?: boolean },
) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <CaptureController into={capture} />
          <Zone
            id={asNodeId('z')}
            strategyId="strip"
            config={{ axis: 'x', fill: true }}
            viewport={{ w: 200, h: 100 }}
            acceptsDrops
            {...extra}
          >
            <Panel id={asNodeId('a')} />
            <Panel id={asNodeId('b')} />
          </Zone>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/** Drag `a`, then hover a point. Rects are stubbed on both sides of the begin:
 *  the drag re-renders, and a fresh element carries jsdom's zero box again. */
async function hoverAt(
  c: DragController,
  container: HTMLElement,
  point: { x: number; y: number },
): Promise<void> {
  stubRects(container);
  c.tryBegin(asNodeId('a'));
  await new Promise((r) => setTimeout(r, 20));
  stubRects(container);
  c.updateHoverByPoint(point.x, point.y);
  // The sample is frame-scheduled, so the hover is not resolved on return.
  await new Promise((r) => setTimeout(r, 20));
}

describe('preset DOM contract, imperative children', () => {
  it('harvests a child the zone rendered imperatively', async () => {
    const store = new Store();
    const zoneId = asNodeId('shelf');
    const { container } = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone
            id={zoneId}
            strategyId="strip"
            config={{ axis: 'x', fill: true }}
            viewport={{ w: 200, h: 100 }}
            renderImperative={(node) => <div className={`imp-${node.id}`} />}
          />
        </StrategyRegistryProvider>
      </Provider>,
    );
    // The zone is JSX-owned, its child is not — the provenance a drop that
    // restructures the tree forces, since a preset cannot adopt a node the
    // store made.
    await act(async () => {
      const impId = asNodeId('imp');
      store.registerNode(createNode({ id: impId, kind: 'panel', focus: true, parentId: zoneId }));
      store.showNode(impId);
    });
    const shelf = container.querySelector('[data-node="shelf"]') as HTMLElement;
    expect(childRectsForContainer(shelf).map((r) => r.id)).toEqual(['imp']);
  });
});

describe('a preset resolves a drop intent', () => {
  it('reports the insertion index the cursor is nearest', async () => {
    const store = new Store();
    let c!: DragController;
    const { container } = render(
      presetTree(
        store,
        (ctl) => {
          c = ctl;
        },
        {},
      ),
    );
    // `a` is in flight, so `b` is the only rect left: a cursor left of its
    // midpoint inserts before it rather than appending after it.
    await hoverAt(c, container, { x: 120, y: 50 });
    expect(c.state()?.hover?.intent).toEqual({ kind: 'insert', index: 0 });
  });

  it('stacks on a centre drop when stackOnDrop is on', async () => {
    const store = new Store();
    let c!: DragController;
    const { container } = render(
      presetTree(
        store,
        (ctl) => {
          c = ctl;
        },
        { stackOnDrop: true },
      ),
    );
    await hoverAt(c, container, { x: 150, y: 50 });
    expect(c.state()?.hover?.intent?.kind).toBe('stack');
  });

  it('splits on a cross-axis edge drop when splitOnDrop is on', async () => {
    const store = new Store();
    let c!: DragController;
    const { container } = render(
      presetTree(
        store,
        (ctl) => {
          c = ctl;
        },
        { splitOnDrop: true },
      ),
    );
    // The top edge of `b` is the cross axis of a horizontal strip.
    await hoverAt(c, container, { x: 150, y: 4 });
    expect(c.state()?.hover?.intent?.kind).toBe('split');
  });
});
