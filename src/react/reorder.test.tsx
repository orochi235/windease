import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  asNodeId,
  configureTrace,
  createNode,
  type DragController,
  type Rect,
  Store,
  stripStrategy,
} from '../index.js';
import { Container } from './Container.js';
import { DragHandle } from './dnd/DragHandle.js';
import { DragProvider, useDragController } from './dnd/DragProvider.js';
import { Provider } from './Provider.js';
import { Panel, Zone } from './presets.js';
import { StrategyRegistryProvider } from './strategies.js';

afterEach(() => {
  cleanup();
  configureTrace(null);
});

const Z = asNodeId('z');
const OTHER = asNodeId('other');

function makeStore(reorder: unknown): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: {
        strategyId: 'strip',
        config: { axis: 'x', fill: true, ...(reorder === undefined ? {} : { reorder }) },
      },
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

function CaptureController({ into }: { into: (c: DragController) => void }) {
  into(useDragController());
  return null;
}

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

/** jsdom lays nothing out: the strip's box is 300×100 and its children 100px
 *  columns in DOM order. */
function stubRow(container: HTMLElement, id = 'z'): void {
  const box = container.querySelector(`[data-node-container="${id}"]`);
  if (box) stubBox(box, { x: 0, y: 0, z: 0, w: 300, h: 100 });
  const kids = Array.from(box?.querySelectorAll(':scope > [data-node]') ?? []);
  kids.forEach((el, i) => {
    stubBox(el, { x: i * 100, y: 0, z: 0, w: 100, h: 100 });
  });
}

const tick = () => new Promise((r) => setTimeout(r, 20));

interface Pointer {
  x: number;
  y: number;
}

/** Press on `el`, move through `path` on the window, release at the last point. */
async function press(el: Element, from: Pointer, path: Pointer[]): Promise<void> {
  await act(async () => {
    fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, pointerId: 1, button: 0 });
  });
  for (const p of path) {
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: p.x, clientY: p.y, pointerId: 1 });
      await tick();
    });
  }
  const end = path.at(-1) ?? from;
  await act(async () => {
    fireEvent.pointerUp(window, { clientX: end.x, clientY: end.y, pointerId: 1 });
    await tick();
  });
}

function order(store: Store, id = Z): string[] {
  return (store.getContainerView(id)?.childOrder ?? []).map(String);
}

function tabChrome(onPick: (id: string) => void, handle = false) {
  return ({ node }: { node: { id: string } }) => (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a test fixture, clicked by id.
    // biome-ignore lint/a11y/noStaticElementInteractions: a test fixture, clicked by id.
    <div data-testid={`tab-${node.id}`} onClick={() => onPick(node.id)}>
      {handle ? <span data-windease-handle data-testid={`grip-${node.id}`} /> : null}
      <span data-testid={`label-${node.id}`}>{node.id}</span>
    </div>
  );
}

function containerTree(store: Store, chrome: ReturnType<typeof tabChrome>, extra?: ReactNode) {
  let controller!: DragController;
  const utils = render(
    <Provider store={store}>
      <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
        <DragProvider dragOverlay={null}>
          <CaptureController
            into={(c) => {
              controller = c;
            }}
          />
          <Container parentId={Z} chrome={chrome as never} viewport={{ w: 300, h: 100 }} />
          {extra}
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>,
  );
  stubRow(utils.container);
  return { ...utils, controller: () => controller };
}

describe('config.reorder on <Container>', () => {
  it('marks every child wrapper as a drag source', () => {
    const { container } = containerTree(
      makeStore(true),
      tabChrome(() => {}),
    );
    const marked = container.querySelectorAll('[data-node][data-windease-reorder="true"]');
    expect(marked).toHaveLength(3);
  });

  it('leaves the wrappers alone when the container does not declare it', () => {
    const { container } = containerTree(
      makeStore(undefined),
      tabChrome(() => {}),
    );
    expect(container.querySelector('[data-windease-reorder]')).toBeNull();
  });

  it('reorders a child dragged by its wrapper, with no DragHandle in the chrome', async () => {
    const store = makeStore(true);
    const { getByTestId } = containerTree(
      store,
      tabChrome(() => {}),
    );
    await press(getByTestId('label-a'), { x: 50, y: 50 }, [
      { x: 60, y: 50 },
      { x: 200, y: 50 },
      { x: 290, y: 50 },
    ]);
    expect(order(store)).toEqual(['b', 'c', 'a']);
  });

  it('keeps a press that moves less than the threshold a click', async () => {
    const store = makeStore(true);
    const picked: string[] = [];
    const { getByTestId, controller } = containerTree(
      store,
      tabChrome((id) => picked.push(id)),
    );
    const label = getByTestId('label-b');
    await act(async () => {
      fireEvent.pointerDown(label, { clientX: 150, clientY: 50, pointerId: 1, button: 0 });
      fireEvent.pointerMove(window, { clientX: 152, clientY: 51, pointerId: 1 });
      await tick();
    });
    expect(controller().state()).toBeNull();
    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 152, clientY: 51, pointerId: 1 });
      fireEvent.click(label);
    });
    expect(picked).toEqual(['b']);
    expect(order(store)).toEqual(['a', 'b', 'c']);
  });

  it('swallows the click that follows a drag', async () => {
    const store = makeStore(true);
    const picked: string[] = [];
    const { getByTestId } = containerTree(
      store,
      tabChrome((id) => picked.push(id)),
    );
    const label = getByTestId('label-a');
    await act(async () => {
      fireEvent.pointerDown(label, { clientX: 50, clientY: 50, pointerId: 1, button: 0 });
      fireEvent.pointerMove(window, { clientX: 290, clientY: 50, pointerId: 1 });
      await tick();
    });
    // The browser dispatches the click in the same task as the release.
    act(() => {
      fireEvent.pointerUp(window, { clientX: 290, clientY: 50, pointerId: 1 });
      fireEvent.click(label);
    });
    expect(picked).toEqual([]);
    expect(order(store)).toEqual(['b', 'c', 'a']);
    await act(tick);
    fireEvent.click(label);
    expect(picked).toEqual(['a']);
  });

  it("'handle' starts a drag only from an element marked data-windease-handle", async () => {
    const store = makeStore('handle');
    const { getByTestId, container } = containerTree(
      store,
      tabChrome(() => {}, true),
    );
    expect(container.querySelectorAll('[data-windease-reorder="handle"]')).toHaveLength(3);
    await press(getByTestId('label-a'), { x: 50, y: 50 }, [
      { x: 60, y: 50 },
      { x: 290, y: 50 },
    ]);
    expect(order(store)).toEqual(['a', 'b', 'c']);
    await press(getByTestId('grip-a'), { x: 50, y: 50 }, [
      { x: 60, y: 50 },
      { x: 290, y: 50 },
    ]);
    expect(order(store)).toEqual(['b', 'c', 'a']);
  });

  it('ignores a press in an editable field inside the child', async () => {
    const store = makeStore(true);
    const { getByTestId } = containerTree(store, (({ node }: { node: { id: string } }) => (
      <input data-testid={`field-${node.id}`} />
    )) as never);
    await press(getByTestId('field-a'), { x: 50, y: 50 }, [
      { x: 60, y: 50 },
      { x: 290, y: 50 },
    ]);
    expect(order(store)).toEqual(['a', 'b', 'c']);
  });

  it('moves a child out to another container that accepts it', async () => {
    const store = makeStore(true);
    store.registerNode(
      createNode({
        kind: 'zone',
        container: { strategyId: 'strip', config: { axis: 'x', fill: true } },
        id: OTHER,
      }),
    );
    store.showNode(OTHER);
    const { getByTestId, container } = containerTree(
      store,
      tabChrome(() => {}),
      <Container parentId={OTHER} chrome={{}} viewport={{ w: 300, h: 100 }} />,
    );
    const other = container.querySelector(`[data-node-container="${OTHER}"]`) as Element;
    stubBox(other, { x: 0, y: 200, z: 0, w: 300, h: 100 });
    await press(getByTestId('label-a'), { x: 50, y: 50 }, [
      { x: 60, y: 50 },
      { x: 150, y: 250 },
    ]);
    expect(order(store)).toEqual(['b', 'c']);
    expect(order(store, OTHER)).toEqual(['a']);
  });

  it('is inert, with a trace, when no DragProvider is mounted', () => {
    configureTrace('dnd');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { container } = render(
      <Provider store={makeStore(true)}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <Container parentId={Z} chrome={{}} viewport={{ w: 300, h: 100 }} />
        </StrategyRegistryProvider>
      </Provider>,
    );
    expect(container.querySelector('[data-windease-reorder]')).toBeNull();
    const lines = log.mock.calls.map((c) => c.join(' '));
    expect(lines.some((l) => l.includes('reorder') && l.includes('no DragProvider'))).toBe(true);
    log.mockRestore();
  });
});

describe('config.reorder on presets', () => {
  function presetTree(children: ReactNode) {
    const store = new Store();
    let controller!: DragController;
    const utils = render(
      <Provider store={store}>
        <StrategyRegistryProvider strategies={{ strip: stripStrategy as never }}>
          <DragProvider dragOverlay={null}>
            <CaptureController
              into={(c) => {
                controller = c;
              }}
            />
            <Zone
              id={Z}
              strategyId="strip"
              config={{ axis: 'x', fill: true, reorder: true }}
              viewport={{ w: 300, h: 100 }}
              acceptsDrops
            >
              {children}
            </Zone>
          </DragProvider>
        </StrategyRegistryProvider>
      </Provider>,
    );
    return { ...utils, store, controller: () => controller };
  }

  it("makes each child preset's own wrapper the drag source", async () => {
    const { container, store, getByTestId } = presetTree(
      ['a', 'b', 'c'].map((id) => (
        <Panel key={id} id={asNodeId(id)}>
          <span data-testid={`label-${id}`}>{id}</span>
        </Panel>
      )),
    );
    const marked = container.querySelectorAll('.windease-panel[data-windease-reorder="true"]');
    expect(marked).toHaveLength(3);
    const box = container.querySelector('[data-node-container="z"]') as Element;
    stubBox(box, { x: 0, y: 0, z: 0, w: 300, h: 100 });
    // The preset hit-test harvests the placement boxes around each shell.
    const kids = Array.from(box.querySelectorAll(':scope > div > [data-node]'));
    kids.forEach((el, i) => {
      stubBox(el, { x: i * 100, y: 0, z: 0, w: 100, h: 100 });
    });
    await press(getByTestId('label-a'), { x: 50, y: 50 }, [
      { x: 60, y: 50 },
      { x: 290, y: 50 },
    ]);
    expect(order(store)).toEqual(['b', 'c', 'a']);
  });

  it('does not start a reorder from a seam inside a child', async () => {
    const { container, controller } = presetTree(
      <Zone
        id={asNodeId('inner')}
        strategyId="strip"
        config={{ axis: 'y', resizeMode: 'neighbor' }}
        viewport={{ w: 300, h: 100 }}
        affordances
      >
        <Panel id={asNodeId('i1')} placement={{ size: { h: 40 } }} />
        <Panel id={asNodeId('i2')} placement={{ size: { h: 40 } }} />
      </Zone>,
    );
    const seam = container.querySelector('.windease-affordance-hit');
    expect(seam).not.toBeNull();
    expect(seam?.closest('[data-windease-reorder]')?.getAttribute('data-node')).toBe('inner');
    await act(async () => {
      fireEvent.pointerDown(seam as Element, { clientX: 50, clientY: 40, pointerId: 1, button: 0 });
      fireEvent.pointerMove(window, { clientX: 50, clientY: 70, pointerId: 1 });
      await tick();
    });
    expect(controller().state()).toBeNull();
    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 50, clientY: 70, pointerId: 1 });
    });
  });
});

describe('drag threshold', () => {
  function handleTree(threshold?: number) {
    const store = makeStore(undefined);
    let controller!: DragController;
    const utils = render(
      <Provider store={store}>
        <DragProvider
          dragOverlay={null}
          {...(threshold !== undefined ? { dragThreshold: threshold } : {})}
        >
          <CaptureController
            into={(c) => {
              controller = c;
            }}
          />
          <DragHandle nodeId={asNodeId('a')}>
            <span data-testid="grip">grip</span>
          </DragHandle>
        </DragProvider>
      </Provider>,
    );
    return { ...utils, controller: () => controller };
  }

  it('DragHandle waits for 4px of travel by default', async () => {
    const { getByTestId, controller } = handleTree();
    await act(async () => {
      fireEvent.pointerDown(getByTestId('grip'), { clientX: 0, clientY: 0, pointerId: 1 });
    });
    expect(controller().state()).toBeNull();
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: 3, clientY: 0, pointerId: 1 });
    });
    expect(controller().state()).toBeNull();
    await act(async () => {
      fireEvent.pointerMove(window, { clientX: 3, clientY: 3, pointerId: 1 });
    });
    expect(controller().state()?.draggingId).toBe('a');
    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 3, clientY: 3, pointerId: 1 });
    });
    expect(controller().state()).toBeNull();
  });

  it('dragThreshold={0} starts the drag on press', async () => {
    const { getByTestId, controller } = handleTree(0);
    await act(async () => {
      fireEvent.pointerDown(getByTestId('grip'), { clientX: 0, clientY: 0, pointerId: 1 });
    });
    expect(controller().state()?.draggingId).toBe('a');
    await act(async () => {
      fireEvent.pointerUp(window, { clientX: 0, clientY: 0, pointerId: 1 });
    });
  });

  it('ignores a secondary-button press', async () => {
    const { getByTestId, controller } = handleTree(0);
    await act(async () => {
      fireEvent.pointerDown(getByTestId('grip'), {
        clientX: 0,
        clientY: 0,
        pointerId: 1,
        button: 2,
      });
    });
    expect(controller().state()).toBeNull();
  });
});
