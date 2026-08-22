export default { title: 'Keyboard move' };

import type { Story } from '@ladle/react';
import { useMemo, useSyncExternalStore } from 'react';
import { asNodeId, createNode, type NodeId, Store, stripStrategy } from '../../index.js';
import {
  type ChromeMap,
  Container,
  FocusProvider,
  GeometryProvider,
  Provider,
  StrategyRegistryProvider,
} from '../index.js';
import '../styles.css';
import './capabilities.css';

const STRATEGIES = { strip: stripStrategy as never };

const ROOT = asNodeId('root');
const LEFT = asNodeId('left');
const RIGHT = asNodeId('right');

const SEED: Array<[string, NodeId, string, boolean]> = [
  ['alpha', LEFT, 'Alpha', false],
  ['bravo', LEFT, 'Bravo', false],
  ['charlie', LEFT, 'Charlie (move-locked)', true],
  ['delta', RIGHT, 'Delta', false],
  ['echo', RIGHT, 'Echo', false],
];

/** Two groups side by side under one root, so each nested container gets a
 *  real origin — directional resolution compares rects across the pair. */
function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: ROOT,
      container: { strategyId: 'strip', config: { axis: 'x', fill: true, gap: 10, padding: 10 } },
    }),
  );
  s.showNode(ROOT);
  for (const [gid, title] of [
    [LEFT, 'Left group'],
    [RIGHT, 'Right group'],
  ] as const) {
    s.registerNode(
      createNode({
        kind: 'group',
        id: gid,
        parentId: ROOT,
        container: { strategyId: 'strip', config: { axis: 'y', fill: true, gap: 8, padding: 8 } },
        meta: { title },
      }),
    );
    s.showNode(gid);
  }
  for (const [id, parentId, title, locked] of SEED) {
    const nid = asNodeId(id);
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
        id: nid,
        parentId,
        meta: { title },
        ...(locked ? { lock: { move: true } } : {}),
      }),
    );
    s.showNode(nid);
  }
  return s;
}

function useChildOrder(store: Store, parentId: NodeId): string {
  return useSyncExternalStore(
    (fn) => store.subscribe(fn),
    () => (store.getNode(parentId)?.container?.childOrder ?? []).join(', '),
  );
}

function Order({ store, id, label }: { store: Store; id: NodeId; label: string }) {
  return (
    <p className="cap-readout">
      {label}: [{useChildOrder(store, id)}]
    </p>
  );
}

export const MoveWithShiftArrow: Story = () => {
  const store = useMemo(() => makeStore(), []);

  const chrome: ChromeMap = useMemo(
    () => ({
      group: ({ node }) => (
        <div className="cap-group">
          <header className="cap-group__title">{String(node.meta?.title ?? node.id)}</header>
          <div className="cap-group__body">
            <Container parentId={node.id} chrome={chrome} />
          </div>
        </div>
      ),
      panel: ({ node }) => (
        <div
          className={`cap-pane${String(node.meta?.title ?? '').includes('locked') ? ' cap-pane--locked' : ''}`}
        >
          <header className="cap-pane__title">{String(node.meta?.title ?? node.id)}</header>
          <div className="cap-pane__body">{String(node.id)}</div>
        </div>
      ),
    }),
    [],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <GeometryProvider>
          <FocusProvider>
            <div className="cap-stage">
              <Container
                parentId={ROOT}
                chrome={chrome}
                viewport={{ w: 720, h: 460 }}
                className="windease-zone"
              />
            </div>
            <p className="cap-hint">
              Tab into the layout, then <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> to move
              the caret and <kbd>Shift</kbd> plus an arrow to move the <em>pane</em>. Shift+Right
              from the left group sends a pane across; the orders below rewrite as it lands. Charlie
              is <code>move</code>-locked, so the key does nothing at all on it — a refusal is
              silent, never an error.
            </p>
            <Order store={store} id={LEFT} label="left " />
            <Order store={store} id={RIGHT} label="right" />
          </FocusProvider>
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
