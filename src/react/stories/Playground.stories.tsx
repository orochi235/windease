export default { title: 'Playground' };

import type { Story } from '@ladle/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { asNodeId, createNode, gridStrategy, Store, stripStrategy } from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  defaultDragOverlay,
  Provider,
  StrategyRegistryProvider,
} from '../index.js';
import './windease.css';
import './playground.css';

const STRATEGIES = {
  grid: gridStrategy as never,
  stack: stripStrategy as never,
  strip: stripStrategy as never,
};

const ROOT = asNodeId('root');
const MAIN = asNodeId('main');
const SIDEBAR = asNodeId('sidebar');
const DOCK = asNodeId('dock');
const MAIN_DOCK_GROUP = asNodeId('main-dock');

function makeStore(): Store {
  const s = new Store();
  // Root arranges three sub-zones: main+dock vertical on the left, sidebar
  // on the right — built with store.split rather than a fixed tree literal.
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'strip', config: { axis: 'x', gap: 6 } },
      id: ROOT,
    }),
  );
  s.registerNode(
    createNode({
      kind: 'panel',
      focus: true,
      id: MAIN,
      parentId: ROOT,
      meta: { title: 'Main' },
      container: { strategyId: 'grid', config: { cols: 2, gap: 8, padding: 8 } },
    }),
  );
  s.showNode(MAIN);

  s.split(ROOT, { direction: 'x', newIds: [SIDEBAR] });
  s.ensureContainer(SIDEBAR, 'stack', { axis: 'y', fill: true, gap: 6, padding: 6 });
  s.setMeta(SIDEBAR, { title: 'Sidebar' });

  s.split(MAIN, { direction: 'y', groupId: MAIN_DOCK_GROUP, newIds: [DOCK], config: { gap: 6 } });
  s.ensureContainer(DOCK, 'strip', { axis: 'x', gap: 6, padding: 6, fill: true });
  s.setMeta(DOCK, { title: 'Dock' });

  // Seed content.
  const seed = (
    id: string,
    parent: ReturnType<typeof asNodeId>,
    title: string,
    h?: number,
    w?: number,
  ) => {
    const nid = asNodeId(id);
    s.registerNode(
      createNode({
        kind: 'panel',
        focus: true,
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
      createNode({
        kind: 'panel',
        focus: true,
        id: nid,
        parentId: parent,
        meta: { title, kind: 'controls' },
      }),
    );
    s.setLock(nid, { move: true });
    s.setPinned(nid, 0);
    s.showNode(nid);
  };
  seedControls('main-controls', MAIN, 'Main controls');
  seed('panel-1', MAIN, 'Panel 1');
  seed('panel-2', MAIN, 'Panel 2');
  seedControls('sidebar-controls', SIDEBAR, 'Sidebar controls');
  // Resizable-children demo: pin the sidebar controls to an explicit 180px
  // height so siblings stay below regardless of available space. The other
  // sidebar widgets get interactive resize edges from strip.
  // Already pinned to index 0 and move-locked by seedControls above; this call only fixes the height.
  s.patchPlacement(asNodeId('sidebar-controls'), { size: { h: 180 } });
  seed('widget-1', SIDEBAR, 'Widget 1', 120);
  seed('widget-2', SIDEBAR, 'Widget 2', 80);
  seed('tool-1', DOCK, 'Tool 1', undefined, 100);
  seed('tool-2', DOCK, 'Tool 2', undefined, 120);
  return s;
}

function ZoneShell({ zoneId, chrome }: { zoneId: ReturnType<typeof asNodeId>; chrome: ChromeMap }) {
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
      const title = `${kind.charAt(0).toUpperCase()}${kind.slice(1)} ${n}`;
      const hints =
        kind === 'widget'
          ? { preferredSize: { w: 0, h: 100 } }
          : kind === 'tool'
            ? { preferredSize: { w: 100, h: 0 } }
            : undefined;
      store.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
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
      // The group `split` interposes to nest Main above Dock — just a
      // pass-through layout level, no chrome of its own.
      group: ({ node }) => (
        <Container parentId={node.id} chrome={chrome} style={{ width: '100%', height: '100%' }} />
      ),
      panel: ({ node }) => {
        // The three top-level zone hosts render as ZoneShell drop targets.
        if (node.id === MAIN || node.id === SIDEBAR || node.id === DOCK) {
          return <ZoneShell zoneId={node.id} chrome={chrome} />;
        }
        // Locked control widgets render the per-zone behavior toggles.
        if (node.meta?.kind === 'controls') {
          const zoneId = node.membership?.parentId;
          if (!zoneId) return null;
          return (
            <ZoneControls
              store={store}
              zoneId={zoneId}
              title={String(node.meta?.title ?? 'Controls')}
              variant={zoneId === MAIN ? 'grid' : zoneId === SIDEBAR ? 'stack' : 'none'}
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
                    className={`pg-panel-btn pg-panel-btn--pin${store.getPinnedIndex(node.id) !== null ? ' is-active' : ''}`}
                    title={store.getPinnedIndex(node.id) !== null ? 'Unpin' : 'Pin'}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (store.getPinnedIndex(node.id) !== null) {
                        store.unpin(node.id);
                      } else {
                        store.setPinned(node.id);
                      }
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
    [store],
  );

  // Re-render on relevant store events.
  const [, force] = useState(0);
  useEffect(() => {
    const offs = [
      store.events.on('node.registered', () => force((n) => n + 1)),
      store.events.on('node.unregistered', () => force((n) => n + 1)),
      store.events.on('node.moved', () => force((n) => n + 1)),
      store.events.on('node.pinnedChanged', () => force((n) => n + 1)),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [store]);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider dragOverlay={defaultDragOverlay}>
          <div className="pg-root">
            <div className="pg-toolbar">
              <button type="button" onClick={() => addPanel(MAIN, 'panel')}>
                + Panel → Main
              </button>
              <button type="button" onClick={() => addPanel(SIDEBAR, 'widget')}>
                + Widget → Sidebar
              </button>
              <button type="button" onClick={() => addPanel(DOCK, 'tool')}>
                + Tool → Dock
              </button>
              <button type="button" onClick={onSnap}>
                Snapshot
              </button>
            </div>
            <div className="pg-canvas">
              <Container parentId={ROOT} chrome={chrome} className="windease-zone" affordances />
            </div>
            <p className="pg-hint">
              Drag panels between Main / Sidebar / Dock. Resize the gutters between zones.{' '}
              <code>Snapshot</code> dumps the store; copy and <code>deserialize</code> elsewhere to
              rehydrate.
            </p>
            {snapText && (
              <textarea className="pg-snap" readOnly value={snapText} spellCheck={false} />
            )}
          </div>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

function ZoneControls({
  store,
  zoneId,
  title,
  variant,
}: {
  store: Store;
  zoneId: ReturnType<typeof asNodeId>;
  title: string;
  variant: 'grid' | 'stack' | 'none';
}) {
  // Subscribe to changes on this zone so checkboxes/inputs reflect current state.
  const [, force] = useState(0);
  useEffect(() => {
    const offs = [
      store.events.on('node.lockChanged', (e) => {
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
  const lock = store.getLock(zoneId);

  const cfg = (container.config ?? {}) as {
    cols?: number;
    rows?: number;
    maxCols?: number;
    maxRows?: number;
    maxItems?: number;
  };

  const onNum =
    (key: 'cols' | 'rows' | 'maxCols' | 'maxRows' | 'maxItems') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value.trim();
      const next = raw === '' ? undefined : Number(raw);
      store.updateContainerConfig(zoneId, { [key]: next });
    };

  return (
    <div className="pg-zone-controls">
      <header className="pg-zone-controls__title">{title}</header>
      <label>
        <input
          type="checkbox"
          checked={lock.accept === true}
          onChange={(e) => store.setLock(zoneId, { ...lock, accept: e.target.checked })}
        />
        lock.accept
      </label>
      <label>
        <input
          type="checkbox"
          checked={lock.dragOut === true}
          onChange={(e) => store.setLock(zoneId, { ...lock, dragOut: e.target.checked })}
        />
        lock.dragOut
      </label>
      <label>
        <input
          type="checkbox"
          checked={container.allowsPinning}
          onChange={(e) => store.setAllowsPinning(zoneId, e.target.checked)}
        />
        allowsPinning
      </label>
      {variant === 'grid' && (
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
          <label>
            maxItems
            <input type="number" min={1} value={cfg.maxItems ?? ''} onChange={onNum('maxItems')} />
          </label>
        </div>
      )}
      {variant === 'stack' && (
        <div className="pg-zone-controls__grid">
          <label>
            maxItems
            <input type="number" min={1} value={cfg.maxItems ?? ''} onChange={onNum('maxItems')} />
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
      parentId: n.membership?.parentId,
      lifecycle: n.lifecycle.state,
      hasContainer: !!n.container,
      meta: n.meta,
    })),
    roots: [...store.rootIds],
  };
}
