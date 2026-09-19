export default { title: 'Pages' };

import type { Story } from '@ladle/react';
import { useEffect, useMemo, useState } from 'react';
import {
  asNodeId,
  createNode,
  desktopStrategy,
  gridStrategy,
  type NodeId,
  type PageAffordanceMeta,
  pageStrategy,
  Store,
  stripStrategy,
} from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  FocusProvider,
  GeometryProvider,
  type OverlayContext,
  Provider,
  StrategyRegistryProvider,
  useStore,
} from '../index.js';
import './pages.css';
import './windease.css';

const STRATEGIES = {
  desktops: pageStrategy(desktopStrategy()) as never,
  tiles: pageStrategy(gridStrategy) as never,
  inbox: stripStrategy as never,
};

const BAR = 28;
const PAGES = 4;
const DESK = asNodeId('desk');
const INBOX = asNodeId('inbox');
const TILES = asNodeId('tiles');

/** The switcher's dots, drawn under the strategy's invisible page buttons. */
function PageBar({ layout }: { layout: OverlayContext }) {
  const pages = layout.affordances.filter((a) => a.id.startsWith('page:'));
  const { command } = layout;
  // Page Up / Page Down flip pages from anywhere but a form control, which has
  // its own use for them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element | null)?.closest?.('select, input, textarea')) return;
      if (e.key === 'PageDown') command({ type: 'next' });
      else if (e.key === 'PageUp') command({ type: 'prev' });
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [command]);
  return (
    <>
      {pages.map((a) => {
        const meta = a.meta as PageAffordanceMeta;
        return (
          <div
            key={a.id}
            className={meta.current ? 'pages-dot pages-dot--current' : 'pages-dot'}
            data-testid={`dot-${meta.page}`}
            data-current={meta.current ? 'true' : undefined}
            aria-hidden="true"
            style={{ left: a.rect.x, top: a.rect.y, width: a.rect.w, height: a.rect.h }}
          >
            {meta.page + 1}
          </div>
        );
      })}
    </>
  );
}

function PageSelect({ id, page }: { id: NodeId; page: unknown }) {
  const store = useStore();
  return (
    <select
      className="pages-move"
      aria-label={`Move ${id} to page`}
      data-testid={`move-${id}`}
      value={typeof page === 'number' ? page : 0}
      onChange={(e) => store.patchPlacement(id, { page: Number(e.target.value) })}
    >
      {Array.from({ length: PAGES }, (_, p) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: pages are their index.
        <option key={p} value={p}>
          Page {p + 1}
        </option>
      ))}
    </select>
  );
}

function makeDesktops(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: DESK,
      container: { strategyId: 'desktops', config: { pages: PAGES, bar: BAR } },
    }),
  );
  s.registerNode(
    createNode({
      kind: 'zone',
      id: INBOX,
      container: { strategyId: 'inbox', config: { axis: 'y', fill: true, gap: 8, padding: 8 } },
    }),
  );
  const add = (id: string, parentId: NodeId, placement: Record<string, unknown>) => {
    s.registerNode(
      createNode({
        kind: 'window',
        focus: true,
        id: asNodeId(id),
        parentId,
        placement,
        hints: { preferredSize: { w: 180, h: 110 } },
        meta: { title: id },
      }),
    );
    s.showNode(asNodeId(id));
  };
  add('mail', DESK, { page: 0, x: 16, y: 16 });
  add('editor', DESK, { page: 0, x: 120, y: 80 });
  add('music', DESK, { page: 1, x: 40, y: 40 });
  add('notes', DESK, { page: 2, x: 200, y: 30 });
  add('photos', INBOX, {});
  add('terminal', INBOX, {});
  return s;
}

/** Four desktops; each window carries its page. Drag one in from the inbox and
 *  it lands on the desktop shown. */
export const Desktops: Story = () => {
  const store = useMemo(() => makeDesktops(), []);
  const chrome: ChromeMap = useMemo(
    () => ({
      window: ({ node }) => (
        <div className="pages-window">
          <DragHandle nodeId={node.id} className="pages-window__bar">
            <span>{String(node.meta?.title ?? node.id)}</span>
          </DragHandle>
          <div className="pages-window__body">
            {node.membership?.parentId === DESK ? (
              <PageSelect id={node.id} page={node.membership.placement.page} />
            ) : (
              'Drag me in'
            )}
          </div>
        </div>
      ),
    }),
    [],
  );
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <GeometryProvider>
            <FocusProvider>
              <div className="pages-row">
                <section className="pages-inbox">
                  <Container parentId={INBOX} chrome={chrome} className="pages-fill" />
                </section>
                <section className="pages-desk">
                  <Container
                    parentId={DESK}
                    chrome={chrome}
                    className="pages-fill"
                    affordances
                    overlay={(layout) => <PageBar layout={layout} />}
                  />
                </section>
              </div>
              <p className="pages-hint">
                Click a page number, or press <kbd>Page Up</kbd> / <kbd>Page Down</kbd>, to switch
                desktops. Each window's menu moves it to another desktop. A window dragged in from
                the left lands on the desktop you are looking at.
              </p>
            </FocusProvider>
          </GeometryProvider>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

function makeTiles(count: number): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: TILES,
      container: {
        strategyId: 'tiles',
        config: { mode: 'flowed', bar: BAR, inner: { cell: { w: 96, h: 72 }, gap: 8 } },
      },
    }),
  );
  for (let i = 1; i <= count; i++) addTile(s, i);
  return s;
}

function addTile(s: Store, n: number): void {
  const id = asNodeId(`tile-${n}`);
  s.registerNode(createNode({ kind: 'tile', focus: true, id, parentId: TILES }));
  s.showNode(id);
}

/** Tiles fill a page in order and spill onto the next, like a launcher's app grid. */
export const Flowed: Story = () => {
  const [store] = useState(() => makeTiles(23));
  const [next, setNext] = useState(24);
  const chrome: ChromeMap = useMemo(
    () => ({ tile: ({ node }) => <div className="pages-tile">{String(node.id).slice(5)}</div> }),
    [],
  );
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="pages-tiles">
          <Container
            parentId={TILES}
            chrome={chrome}
            className="pages-fill"
            affordances
            overlay={(layout) => <PageBar layout={layout} />}
          />
        </div>
        <button
          type="button"
          className="pages-add"
          onClick={() => {
            addTile(store, next);
            setNext(next + 1);
          }}
        >
          Add a tile
        </button>
        <p className="pages-hint">
          Tiles flow onto a new page when this one is full. Click a page number, or press{' '}
          <kbd>Page Up</kbd> / <kbd>Page Down</kbd>, to turn the page.
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
};
