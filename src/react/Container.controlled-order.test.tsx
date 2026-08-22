import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  asNodeId,
  type ChildOrderCommit,
  createNode,
  type DragController,
  type NodeId,
  Store,
  stripStrategy,
} from '../index.js';
import { Container } from './Container.js';
import { DragProvider, useDragController } from './dnd/DragProvider.js';
import { Provider } from './Provider.js';
import { StrategyRegistryProvider } from './strategies.js';

const Z = asNodeId('z');

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'y' } },
      id: Z,
    }),
  );
  s.showNode(Z);
  for (const c of ['a', 'b', 'c']) {
    const nid = asNodeId(c);
    s.registerNode(createNode({ kind: 'panel', focus: true, id: nid, parentId: Z }));
    s.showNode(nid);
  }
  return s;
}

/** `<DragProvider>` builds its own controller; a drop has to be driven through
 *  that one, not a second instance the test made. */
function CaptureController({ into }: { into: (c: DragController) => void }) {
  into(useDragController());
  return null;
}

function tree(
  store: Store,
  onChildOrderChange: ChildOrderCommit | undefined,
  capture: (c: DragController) => void,
) {
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <DragProvider>
          <CaptureController into={capture} />
          <Container
            parentId={Z}
            chrome={{}}
            viewport={{ w: 200, h: 300 }}
            {...(onChildOrderChange ? { onChildOrderChange } : {})}
          />
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
}

function fakeElement(x: number, y: number, w: number, h: number): Element {
  return {
    getBoundingClientRect: () => ({ x, y, width: w, height: h, left: x, top: y }),
    setAttribute: () => {},
    removeAttribute: () => {},
    parentElement: null,
  } as unknown as Element;
}

async function dropAt(c: DragController, sourceId: string, at: number) {
  c.tryBegin(asNodeId(sourceId));
  c.registerDropTarget(Z, fakeElement(0, 0, 100, 100), undefined, {
    getInsertionIndex: () => at,
  });
  c.updateHoverByPoint(50, 50);
  await new Promise((r) => setTimeout(r, 20));
  c.drop();
}

describe('<Container onChildOrderChange>', () => {
  it('registers the control so a drop reaches the host', async () => {
    const store = makeStore();
    let controller!: DragController;
    const onChildOrderChange = vi.fn();
    render(
      tree(store, onChildOrderChange, (c) => {
        controller = c;
      }),
    );

    await dropAt(controller, 'c', 0);

    expect(onChildOrderChange).toHaveBeenCalledTimes(1);
    expect(onChildOrderChange.mock.calls[0]?.[0]).toEqual(['c', 'a', 'b']);
    expect(store.getContainerView(Z)?.childOrder).toEqual(['a', 'b', 'c']);
  });

  it('a host that commits the intent ends up with the new order', async () => {
    // The round trip a host actually writes: hold order yourself, take the
    // intent, apply it. Without the intent there is nowhere to put the drop.
    const store = makeStore();
    let controller!: DragController;
    let committed: NodeId[] = [];

    function Host() {
      const [order, setOrder] = useState<NodeId[]>(() => [
        ...(store.getContainerView(Z)?.childOrder ?? []),
      ]);
      committed = order;
      return tree(
        store,
        (next) => {
          setOrder(next);
          store.setChildOrder(Z, next);
        },
        (c) => {
          controller = c;
        },
      );
    }
    render(<Host />);

    await dropAt(controller, 'c', 0);

    await waitFor(() => expect(committed).toEqual(['c', 'a', 'b']));
    expect(store.getContainerView(Z)?.childOrder).toEqual(['c', 'a', 'b']);
  });

  it('drops back to store-owned order when the prop goes away', async () => {
    const store = makeStore();
    let controller!: DragController;
    const capture = (c: DragController) => {
      controller = c;
    };
    const { rerender } = render(tree(store, vi.fn(), capture));
    rerender(tree(store, undefined, capture));

    await dropAt(controller, 'c', 0);

    expect(store.getContainerView(Z)?.childOrder).toEqual(['c', 'a', 'b']);
  });
});
