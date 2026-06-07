export default { title: 'Playground' };

import {
  asNodeId,
  createPanel,
  createZone,
  gridStrategy,
  splitStrategy,
  type SplitNode,
  stackStrategy,
  stripStrategy,
  Store,
} from '../../index.js';
import type { Story } from '@ladle/react';
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  Panel,
  StrategyRegistryProvider,
  useDropTarget,
  Provider,
} from '../index.js';
import './windease.css';
import './playground.css';

const STRATEGIES = {
  split: splitStrategy as never,
  grid: gridStrategy as never,
  stack: stackStrategy as never,
  strip: stripStrategy as never,
};

const ROOT = asNodeId('root');
const MAIN = asNodeId('main');
const SIDEBAR = asNodeId('sidebar');
const DOCK = asNodeId('dock');

// Workspace tree: main+dock vertical on the left, sidebar on the right.
const INITIAL_TREE: SplitNode = {
  kind: 'split',
  direction: 'horizontal',
  ratio: 0.75,
  a: {
    kind: 'split',
    direction: 'vertical',
    ratio: 0.82,
    a: { kind: 'leaf', id: 'main' },
    b: { kind: 'leaf', id: 'dock' },
  },
  b: { kind: 'leaf', id: 'sidebar' },
};

function makeStore(): Store {
  const s = new Store();
  // Root is a splitStrategy container that arranges three sub-zones.
  s.registerNode(
    createZone({ id: ROOT, strategyId: 'split', config: { gutterSize: 6 } }),
  );
  // Each zone is itself a child of root with its own strategy.
  s.registerNode(
    createPanel({
      id: MAIN,
      parentId: ROOT,
      meta: { title: 'Main' },
      container: { strategyId: 'grid', config: { cols: 2, gap: 8, padding: 8 } },
    }),
  );
  s.showNode(MAIN);
  s.registerNode(
    createPanel({
      id: SIDEBAR,
      parentId: ROOT,
      meta: { title: 'Sidebar' },
      container: { strategyId: 'stack', config: { gap: 6, padding: 6 } },
    }),
  );
  s.showNode(SIDEBAR);
  s.registerNode(
    createPanel({
      id: DOCK,
      parentId: ROOT,
      meta: { title: 'Dock' },
      container: { strategyId: 'strip', config: { axis: 'x', gap: 6, padding: 6, fill: true } },
      allowsDrop: true,
    }),
  );
  s.showNode(DOCK);
  s.setContainerState(ROOT, INITIAL_TREE);

  // Seed content.
  const seed = (id: string, parent: ReturnType<typeof asNodeId>, title: string, h?: number, w?: number) => {
    const nid = asNodeId(id);
    s.registerNode(
      createPanel({
        id: nid,
        parentId: parent,
        meta: { title },
        ...(h !== undefined || w !== undefined
          ? { hints: { preferredSize: { w: w ?? 0, h: h ?? 0 } } }
          : {}),
      }),
    );
    s.showNode(nid);
  };
  seed('panel-1', MAIN, 'Panel 1');
  seed('panel-2', MAIN, 'Panel 2');
  seed('widget-1', SIDEBAR, 'Widget 1', 120);
  seed('widget-2', SIDEBAR, 'Widget 2', 80);
  seed('tool-1', DOCK, 'Tool 1', undefined, 100);
  seed('tool-2', DOCK, 'Tool 2', undefined, 120);
  return s;
}

function ZoneShell({
  zoneId,
  chrome,
}: {
  zoneId: ReturnType<typeof asNodeId>;
  chrome: ChromeMap;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDropTarget(zoneId, ref as RefObject<Element | null>);
  return (
    <div ref={ref} className="pg-zone-shell">
      <Container parentId={zoneId} chrome={chrome} className="pg-zone-inner" />
    </div>
  );
}

export const Playground: Story = () => {
  const store = useMemo(() => makeStore(), []);
  const [snapText, setSnapText] = useState('');
  const counter = useRef({ panel: 2, widget: 2, tool: 2 });

  const addPanel = useCallback(
    (zone: ReturnType<typeof asNodeId>, kind: 'panel' | 'widget' | 'tool') => {
      counter.current[kind] += 1;
      const n = counter.current[kind];
      const id = asNodeId(`${kind}-${n}`);
      const title = `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`;
      const hints =
        kind === 'widget'
          ? { preferredSize: { w: 0, h: 100 } }
          : kind === 'tool'
            ? { preferredSize: { w: 100, h: 0 } }
            : undefined;
      store.registerNode(
        createPanel({
          id,
          parentId: zone,
          meta: { title },
          ...(hints ? { hints } : {}),
        }),
      );
      store.showNode(id);
    },
    [store],
  );

  const onSnap = () => {
    setSnapText(JSON.stringify(serializeSafely(store), null, 2));
  };

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => {
        // The three top-level zone hosts render as ZoneShell drop targets.
        if (node.id === MAIN || node.id === SIDEBAR || node.id === DOCK) {
          return <ZoneShell zoneId={node.id} chrome={chrome} />;
        }
        return (
          <DragHandle nodeId={node.id} className="pg-drag">
            <Panel title={String(node.meta?.title ?? node.id)} />
          </DragHandle>
        );
      },
    }),
    // biome-ignore lint/correctness/useExhaustiveDependencies: chrome refers to itself via closure
    [],
  );

  // Re-render on relevant store events.
  const [, force] = useState(0);
  useEffect(() => {
    const offs = [
      store.events.on('node.registered', () => force((n) => n + 1)),
      store.events.on('node.unregistered', () => force((n) => n + 1)),
      store.events.on('node.moved', () => force((n) => n + 1)),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [store]);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <div className="pg-toolbar">
            <button type="button" onClick={() => addPanel(MAIN, 'panel')}>+ Panel → Main</button>
            <button type="button" onClick={() => addPanel(SIDEBAR, 'widget')}>+ Widget → Sidebar</button>
            <button type="button" onClick={() => addPanel(DOCK, 'tool')}>+ Tool → Dock</button>
            <button type="button" onClick={onSnap}>Snapshot</button>
          </div>
          <div className="pg-canvas">
            <Container
              parentId={ROOT}
              chrome={chrome}
              viewport={{ w: 900, h: 540 }}
              className="windease-zone"
              affordances
            />
          </div>
          <p className="pg-hint">
            Drag panels between Main / Sidebar / Dock. Resize the gutters between
            zones. <code>Snapshot</code> dumps the store; copy and{' '}
            <code>deserialize</code> elsewhere to rehydrate.
          </p>
          {snapText && (
            <textarea
              className="pg-snap"
              readOnly
              value={snapText}
              spellCheck={false}
            />
          )}
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

/** Strip the live FSM instances out so the snapshot is JSON-safe and small. */
function serializeSafely(store: Store): unknown {
  return {
    nodes: [...store.nodes.values()].map((n) => ({
      id: n.id,
      kind: n.kind,
      parentId: n.slot?.parentId,
      lifecycle: n.lifecycle.state,
      hasContainer: !!n.container,
      meta: n.meta,
    })),
    roots: [...store.rootIds],
  };
}
