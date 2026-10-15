export default { title: 'Workspace' };

import type { Story } from '@ladle/react';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  asNodeId,
  createNode,
  type NodeHints,
  type NodeId,
  Store,
  stripStrategy,
  type WorkspaceSeam,
} from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  FocusProvider,
  GeometryProvider,
  Provider,
  StrategyRegistryProvider,
  useNode,
  useRootNodes,
  Workspace,
  WorkspaceRoot,
} from '../index.js';
import './windease.css';
import './workspace.css';

const STRATEGIES = { strip: stripStrategy as never };

const SIDE = asNodeId('ws-side');
const MAIN = asNodeId('ws-main');
const DOCK = asNodeId('ws-dock');

const ROOTS: Array<{
  id: NodeId;
  title: string;
  axis: 'x' | 'y';
  hints: NodeHints;
  panels: string[];
}> = [
  {
    id: SIDE,
    title: 'Sidebar',
    axis: 'y',
    hints: { minSize: { w: 120, h: 0 }, maxSize: { w: 360, h: 0 } },
    panels: ['Files', 'Outline'],
  },
  {
    id: MAIN,
    title: 'Main',
    axis: 'x',
    hints: { minSize: { w: 240, h: 160 } },
    panels: ['Editor', 'Preview'],
  },
  {
    id: DOCK,
    title: 'Dock',
    axis: 'x',
    hints: { minSize: { w: 0, h: 60 }, maxSize: { w: 0, h: 240 } },
    panels: ['Terminal', 'Problems'],
  },
];

/** The sidebar's seam sizes the sidebar; the dock's sizes the dock, which sits
 *  after it. Either pushed past its floor hides that root. */
const SEAMS: WorkspaceSeam[] = [
  { before: SIDE, after: MAIN, axis: 'x', overshoot: 'hide' },
  { before: MAIN, after: DOCK, axis: 'y', sizes: 'after', overshoot: 'hide' },
];

function makeStore(mainHides = false): Store {
  const s = new Store();
  for (const root of ROOTS) {
    s.registerNode(
      createNode({
        kind: 'zone',
        id: root.id,
        container: { strategyId: 'strip', config: { axis: root.axis, fill: true, gap: 6 } },
        meta: { title: root.title },
        hints: root.hints,
      }),
    );
    s.showNode(root.id);
    for (const title of root.panels) {
      const id = asNodeId(`ws-${title.toLowerCase()}`);
      s.registerNode(
        createNode({ kind: 'panel', focus: true, id, parentId: root.id, meta: { title } }),
      );
      s.showNode(id);
    }
  }
  // Main is what is left when the others close, so no seam may hide it.
  if (!mainHides) s.setLock(MAIN, { hide: true });
  return s;
}

const CHROME: ChromeMap = {
  zone: ({ children }) => <>{children}</>,
  panel: ({ node }) => (
    <DragHandle nodeId={node.id} className="ws-panel">
      {String(node.meta?.title ?? node.id)}
    </DragHandle>
  ),
};

function Toggle({ store, id, label }: { store: Store; id: NodeId; label: string }) {
  const hidden = useNode(id)?.lifecycle.state === 'hidden';
  return (
    <button
      type="button"
      data-testid={`ws-toggle-${id}`}
      aria-pressed={!hidden}
      onClick={() => (hidden ? store.showNode(id) : store.hideNode(id))}
    >
      {hidden ? `Show ${label}` : `Hide ${label}`}
    </button>
  );
}

function ResizeLock({ store, id, label }: { store: Store; id: NodeId; label: string }) {
  const locked = useNode(id)?.lock?.resize === true;
  return (
    <button
      type="button"
      data-testid={`ws-lock-${id}`}
      aria-pressed={locked}
      onClick={() => store.setLock(id, { ...store.getLock(id), resize: !locked })}
    >
      {locked ? `Unlock ${label} size` : `Lock ${label} size`}
    </button>
  );
}

/** Zoom kept on the root, where a snapshot carries it. */
function ZoomToggle({ store, id, label }: { store: Store; id: NodeId; label: string }) {
  const zoomed = useNode(id)?.hints?.zoom === true;
  return (
    <button
      type="button"
      data-testid="ws-zoom"
      aria-pressed={zoomed}
      onClick={() => store.setHints(id, { zoom: zoomed ? undefined : true })}
    >
      {zoomed ? `Unzoom ${label}` : `Zoom ${label}`}
    </button>
  );
}

/** Which root holds focus, read with `store.getRoot`, and a button that sends
 *  the focused panel to main with one `moveNode`. */
function FocusedRoot({ store }: { store: Store }) {
  const rootId = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => (store.focusedId ? store.getRoot(store.focusedId)?.id : undefined),
  );
  const title = rootId ? String(store.getNode(rootId)?.meta?.title ?? rootId) : 'nothing';
  const panel = store.focusedId;
  return (
    <div className="ws-readout">
      Focus is in <code data-testid="ws-focused-root">{title}</code>{' '}
      <button
        type="button"
        data-testid="ws-send-to-main"
        disabled={!panel || rootId === MAIN}
        onClick={() => panel && store.moveNode(panel, MAIN)}
      >
        Send to main
      </button>
    </div>
  );
}

function Readout({ id, label }: { id: NodeId; label: string }) {
  const node = useNode(id);
  const size = node?.hints?.size;
  const value =
    node?.lifecycle.state === 'hidden'
      ? 'hidden'
      : size
        ? Object.entries(size)
            .map(([k, v]) => `${k} ${Math.round(v)}`)
            .join(', ')
        : 'as the CSS has it';
  return (
    <div className="ws-readout">
      {label} <code data-testid={`ws-size-${id}`}>{value}</code>
    </div>
  );
}

export const RootsInTheHostsLayout: Story = () => {
  const store = useMemo(() => makeStore(), []);

  const root = (id: NodeId, className: string) => (
    <WorkspaceRoot id={id} className={className}>
      <Container parentId={id} chrome={CHROME} className="ws-zone" />
    </WorkspaceRoot>
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <GeometryProvider>
            <FocusProvider>
              <div className="ws-controls">
                <Toggle store={store} id={SIDE} label="sidebar" />
                <Toggle store={store} id={DOCK} label="dock" />
                <ResizeLock store={store} id={SIDE} label="sidebar" />
                <ZoomToggle store={store} id={MAIN} label="main" />
              </div>
              <Workspace className="ws-shell" seams={SEAMS}>
                <div className="ws-top">
                  {root(SIDE, 'ws-side')}
                  {root(MAIN, 'ws-main')}
                </div>
                {root(DOCK, 'ws-dock')}
              </Workspace>
              <Readout id={SIDE} label="Sidebar" />
              <Readout id={DOCK} label="Dock" />
              <FocusedRoot store={store} />
              <p className="ws-prose">
                Three root zones, placed by this story's own flexbox — none is a child of another.
                Drag the seam beside the sidebar or above the dock; push either past its floor and
                release to hide it, then drag the handle it leaves on the main area's edge to bring
                it back. Panels still drag between the three, and <kbd>←</kbd> <kbd>→</kbd>{' '}
                <kbd>↑</kbd> <kbd>↓</kbd> cross between them. Click a panel in the sidebar or dock
                and press Send to main to move it there.
              </p>
            </FocusProvider>
          </GeometryProvider>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

const SIDE_SEAM: WorkspaceSeam[] = [{ before: SIDE, after: MAIN, axis: 'x' }];

/**
 * The seam sizes the sidebar and main takes what is left. Hide main and nothing
 * is left to take it: the sidebar's dragged width is withheld, and the story's
 * CSS reads `data-workspace-fill` to let it have the row.
 */
export const ASizedRootLeftAlone: Story = () => {
  const store = useMemo(() => makeStore(true), []);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <div className="ws-controls">
            <Toggle store={store} id={MAIN} label="main" />
          </div>
          <Workspace className="ws-shell ws-row" seams={SIDE_SEAM}>
            <WorkspaceRoot id={SIDE} className="ws-side">
              <Container parentId={SIDE} chrome={CHROME} className="ws-zone" />
            </WorkspaceRoot>
            <WorkspaceRoot id={MAIN} className="ws-main">
              <Container parentId={MAIN} chrome={CHROME} className="ws-zone" />
            </WorkspaceRoot>
          </Workspace>
          <Readout id={SIDE} label="Sidebar" />
          <p className="ws-prose">
            Drag the seam, then hide main. The sidebar takes the whole row; show main again and it
            goes back to the width you dragged it to.
          </p>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

const HOME = asNodeId('wz-main');

function zoneNode(id: NodeId, title: string) {
  return createNode({
    kind: 'zone',
    id,
    container: { strategyId: 'strip', config: { axis: 'y', fill: true, gap: 6 } },
    meta: { title },
  });
}

function panelNode(id: string, parentId: NodeId, title: string) {
  return createNode({ kind: 'panel', focus: true, id: asNodeId(id), parentId, meta: { title } });
}

function WorktreeColumn({ store, id, rehome }: { store: Store; id: NodeId; rehome: boolean }) {
  const title = String(useNode(id)?.meta?.title ?? id);
  return (
    <section className="wz-column" data-testid={`wz-column-${id}`}>
      <header className="wz-column__header">
        {title}
        {id === HOME ? null : (
          <button
            type="button"
            data-testid={`wz-remove-${id}`}
            onClick={() => store.unregisterNode(id, rehome ? { rehome: HOME } : undefined)}
          >
            Remove
          </button>
        )}
      </header>
      <Container parentId={id} chrome={CHROME} className="ws-zone" />
    </section>
  );
}

/**
 * Zones that come and go, one per worktree. Each new worktree zone opens with
 * a panel of its own, and panels drag between the zones. Removing a zone with
 * "Keep its panels" checked calls `unregisterNode(id, { rehome: main })`, so
 * its panels move to main; unchecked, they go with it.
 */
export const WorktreeZones: Story = () => {
  const store = useMemo(() => {
    const s = new Store();
    s.registerNode(zoneNode(HOME, 'main'));
    s.showNode(HOME);
    s.registerNode(panelNode('wz-editor', HOME, 'Editor'));
    s.showNode(asNodeId('wz-editor'));
    return s;
  }, []);
  const next = useRef(1);
  const [rehome, setRehome] = useState(true);

  const add = () => {
    const n = next.current++;
    const id = asNodeId(`wz-wt${n}`);
    store.transact(() => {
      store.registerNode(zoneNode(id, `worktree ${n}`));
      store.showNode(id);
      const panel = `wz-wt${n}-notes`;
      store.registerNode(panelNode(panel, id, `Notes ${n}`));
      store.showNode(asNodeId(panel));
    }, 'add worktree');
  };

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <div className="ws-controls">
            <button type="button" data-testid="wz-add" onClick={add}>
              Add worktree
            </button>
            <label>
              <input
                type="checkbox"
                data-testid="wz-rehome"
                checked={rehome}
                onChange={(e) => setRehome(e.currentTarget.checked)}
              />{' '}
              Keep its panels when a worktree is removed
            </label>
          </div>
          <WorktreeRow store={store} rehome={rehome} />
          <p className="ws-prose">
            Add a worktree or two, drag panels between the zones, then remove one. With the box
            checked its panels land in main; unchecked, they are destroyed with it.
          </p>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

function WorktreeRow({ store, rehome }: { store: Store; rehome: boolean }) {
  const roots = useRootNodes();
  return (
    <div className="wz-row">
      {roots.map((r) => (
        <WorktreeColumn key={r.id} store={store} id={r.id} rehome={rehome} />
      ))}
    </div>
  );
}
