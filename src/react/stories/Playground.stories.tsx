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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ChromeMap,
  Container,
  defaultDragOverlay,
  DragHandle,
  DragProvider,
  StrategyRegistryProvider,
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
  // Locked control widgets — pinned to the head of their zones, render the
  // ZoneControls UI via chrome, and cannot be dragged out or destroyed.
  const seedControls = (id: string, parent: ReturnType<typeof asNodeId>, title: string) => {
    const nid = asNodeId(id);
    s.registerNode(
      createPanel({
        id: nid,
        parentId: parent,
        meta: { title, kind: 'controls' },
      }),
    );
    s.patchPlacement(nid, { locked: true, pinned: true });
    s.showNode(nid);
  };
  seedControls('main-controls', MAIN, 'Main controls');
  seed('panel-1', MAIN, 'Panel 1');
  seed('panel-2', MAIN, 'Panel 2');
  seedControls('sidebar-controls', SIDEBAR, 'Sidebar controls');
  // Resizable-children demo: pin the sidebar controls to an explicit 180px
  // height so siblings stay below regardless of available space. The other
  // sidebar widgets get interactive resize edges from the stack strategy.
  s.patchPlacement(asNodeId('sidebar-controls'), {
    locked: true,
    pinned: true,
    size: { h: 180 },
  });
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
  // Container itself registers as the drop target (and the default
  // getInsertionIndex callback). An extra useDropTarget here would clobber
  // that registration because child effects fire before parent effects in
  // React — leaving every drop appending instead of inserting at the cursor.
  return (
    <div className="pg-zone-shell">
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
        // Locked control widgets render the per-zone behavior toggles.
        if (node.meta?.kind === 'controls') {
          const zoneId = node.slot?.parentId;
          if (!zoneId) return null;
          return (
            <ZoneControls
              store={store}
              zoneId={zoneId}
              title={String(node.meta?.title ?? 'Controls')}
              includeGridFields={zoneId === MAIN}
            />
          );
        }
        return (
          <DragHandle nodeId={node.id} className="pg-drag">
            <div className="windease-panel">
              <header className="windease-panel__title">
                <span>{String(node.meta?.title ?? node.id)}</span>
                <span className="pg-panel-actions">
                  <button
                    type="button"
                    className={
                      'pg-panel-btn pg-panel-btn--pin' +
                      (node.slot?.placement?.pinned ? ' is-active' : '')
                    }
                    title={node.slot?.placement?.pinned ? 'Unpin' : 'Pin'}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      const pinned = !node.slot?.placement?.pinned;
                      store.patchPlacement(node.id, { pinned: pinned ? true : undefined });
                    }}
                  >
                    📌
                  </button>
                  <button
                    type="button"
                    className="pg-panel-btn pg-panel-btn--close"
                    title="Close"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      store.unregisterNode(node.id);
                    }}
                  >
                    ✕
                  </button>
                </span>
              </header>
            </div>
          </DragHandle>
        );
      },
    }),
    // biome-ignore lint/correctness/useExhaustiveDependencies: chrome refers to itself via closure
    [store],
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
        <DragProvider dragOverlay={defaultDragOverlay}>
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

function ZoneControls({
  store,
  zoneId,
  title,
  includeGridFields,
}: {
  store: Store;
  zoneId: ReturnType<typeof asNodeId>;
  title: string;
  includeGridFields: boolean;
}) {
  // Subscribe to changes on this zone so checkboxes/inputs reflect current state.
  const [, force] = useState(0);
  useEffect(() => {
    const offs = [
      store.events.on('container.allowsDropChanged', (e) => {
        if (e.id === zoneId) force((n) => n + 1);
      }),
      store.events.on('container.allowsDragOutChanged', (e) => {
        if (e.id === zoneId) force((n) => n + 1);
      }),
      store.events.on('container.allowsPinningChanged', (e) => {
        if (e.id === zoneId) force((n) => n + 1);
      }),
      store.events.on('container.configChanged', (e) => {
        if (e.id === zoneId) force((n) => n + 1);
      }),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [store, zoneId]);

  const node = store.getNode(zoneId);
  const container = node?.container;
  if (!container) return null;

  const cfg = (container.config ?? {}) as {
    cols?: number;
    rows?: number;
    maxCols?: number;
    maxRows?: number;
  };

  const onNum =
    (key: 'cols' | 'rows' | 'maxCols' | 'maxRows') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.trim();
      const next = raw === '' ? undefined : Number(raw);
      store.patchContainerConfig(zoneId, { [key]: next });
    };

  return (
    <div className="pg-zone-controls">
      <header className="pg-zone-controls__title">{title}</header>
      <label>
        <input
          type="checkbox"
          checked={container.allowsDrop}
          onChange={(e) => store.setAllowsDrop(zoneId, e.target.checked)}
        />
        allowsDrop
      </label>
      <label>
        <input
          type="checkbox"
          checked={container.allowsDragOut}
          onChange={(e) => store.setAllowsDragOut(zoneId, e.target.checked)}
        />
        allowsDragOut
      </label>
      <label>
        <input
          type="checkbox"
          checked={container.allowsPinning}
          onChange={(e) => store.setAllowsPinning(zoneId, e.target.checked)}
        />
        allowsPinning
      </label>
      {includeGridFields && (
        <div className="pg-zone-controls__grid">
          <label>
            cols
            <input type="number" min={1} value={cfg.cols ?? ''} onChange={onNum('cols')} />
          </label>
          <label>
            rows
            <input type="number" min={1} value={cfg.rows ?? ''} onChange={onNum('rows')} />
          </label>
          <label>
            maxCols
            <input type="number" min={1} value={cfg.maxCols ?? ''} onChange={onNum('maxCols')} />
          </label>
          <label>
            maxRows
            <input type="number" min={1} value={cfg.maxRows ?? ''} onChange={onNum('maxRows')} />
          </label>
        </div>
      )}
    </div>
  );
}

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
