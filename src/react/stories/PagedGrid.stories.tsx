export default { title: 'Paged grid' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import {
  asNodeId,
  createNode,
  gridStrategy,
  type NodeId,
  pageStrategy,
  Store,
  stripStrategy,
} from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  GeometryProvider,
  Provider,
  StrategyRegistryProvider,
} from '../index.js';
import { PageDots } from './PageDots.js';
import './pages.css';
import './windease.css';

const STRATEGIES = {
  board: pageStrategy(gridStrategy) as never,
  inbox: stripStrategy as never,
};

const BOARD = asNodeId('board');
const INBOX = asNodeId('inbox');

function makeBoard(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: BOARD,
      container: {
        strategyId: 'board',
        config: {
          pages: 2,
          bar: 28,
          drop: { cell: true },
          inner: { cols: 3, rows: 2, maxItems: 6, fill: false, gap: 8, padding: 8 },
        },
      },
    }),
  );
  s.registerNode(
    createNode({
      kind: 'zone',
      id: INBOX,
      container: { strategyId: 'inbox', config: { axis: 'y', gap: 8, padding: 8 } },
    }),
  );
  const add = (id: string, parentId: NodeId, placement: Record<string, unknown>) => {
    s.registerNode(
      createNode({
        kind: 'card',
        id: asNodeId(id),
        parentId,
        placement,
        hints: { preferredSize: { w: 160, h: 60 } },
      }),
    );
    s.showNode(asNodeId(id));
  };
  for (let i = 0; i < 6; i++) add(`full-${i + 1}`, BOARD, { page: 0 });
  add('room-1', BOARD, { page: 1, cell: { col: 0, row: 0 } });
  add('room-2', BOARD, { page: 1, cell: { col: 2, row: 1 } });
  add('new-1', INBOX, {});
  add('new-2', INBOX, {});
  return s;
}

/** Two pages of a 3×2 grid. The first is full and turns a drop away; on the
 *  second, a card lands in the empty cell it is dropped on. */
export const CellDrop: Story = () => {
  const store = useMemo(() => makeBoard(), []);
  const chrome: ChromeMap = useMemo(
    () => ({
      card: ({ node }) => (
        <div className="pages-window">
          <DragHandle nodeId={node.id} className="pages-window__bar">
            <span>{String(node.id)}</span>
          </DragHandle>
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
            <div className="pages-row">
              <section className="pages-inbox">
                <Container parentId={INBOX} chrome={chrome} className="pages-fill" />
              </section>
              <section className="pages-desk">
                <Container
                  parentId={BOARD}
                  chrome={chrome}
                  className="pages-fill"
                  affordances
                  overlay={(layout) => <PageDots layout={layout} />}
                />
              </section>
            </div>
            <p className="pages-hint">
              Page 1 is full, so a card dragged onto it is refused. Switch to page 2 and drop a card
              on an empty cell: it lands in that cell.
            </p>
          </GeometryProvider>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
