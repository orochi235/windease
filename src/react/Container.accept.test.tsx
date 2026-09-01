import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type AcceptContext,
  asNodeId,
  createNode,
  type DragController,
  type Rect,
  Store,
  stripStrategy,
} from '../index.js';
import { Container } from './Container.js';
import { DragProvider, useDragController } from './dnd/DragProvider.js';
import { Provider } from './Provider.js';
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
  canAccept?: (ctx: AcceptContext) => boolean | undefined;
}

function tree({ store, capture, canAccept }: TreeProps) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <DragProvider>
          <CaptureController into={capture} />
          <Container
            parentId={Z}
            chrome={{}}
            viewport={{ w: 200, h: 100 }}
            {...(canAccept ? { canAccept } : {})}
          />
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/** jsdom lays nothing out, so the container's box has to be staged by hand or
 *  the cursor hits no target at all. */
function stubRects(container: HTMLElement): void {
  const asDomRect = (r: Rect) =>
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
  const box = container.querySelector('[data-node-container]');
  if (box) box.getBoundingClientRect = () => asDomRect({ x: 0, y: 0, w: 200, h: 100 });
  const kids = Array.from(container.querySelectorAll('[data-node]'));
  kids.forEach((el, i) => {
    const w = 200 / Math.max(1, kids.length);
    el.getBoundingClientRect = () => asDomRect({ x: i * w, y: 0, w, h: 100 });
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

function mount(store: Store, canAccept?: (ctx: AcceptContext) => boolean | undefined) {
  let controller!: DragController;
  const { container } = render(
    tree({
      store,
      ...(canAccept ? { canAccept } : {}),
      capture: (c) => {
        controller = c;
      },
    }),
  );
  return { container, controller: () => controller };
}

describe('<Container canAccept>', () => {
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
