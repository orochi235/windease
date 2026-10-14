export default { title: 'Workspace' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
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

function makeStore(): Store {
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
  s.setLock(MAIN, { hide: true });
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
              <p className="ws-prose">
                Three root zones, placed by this story's own flexbox — none is a child of another.
                Drag the seam beside the sidebar or above the dock; push either past its floor and
                release to hide it, then drag the handle it leaves on the main area's edge to bring
                it back. Panels still drag between the three, and <kbd>←</kbd> <kbd>→</kbd>{' '}
                <kbd>↑</kbd> <kbd>↓</kbd> cross between them.
              </p>
            </FocusProvider>
          </GeometryProvider>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
