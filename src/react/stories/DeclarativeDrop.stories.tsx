export default { title: 'Declarative' };

import type { Story } from '@ladle/react';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  asNodeId,
  createNode,
  type DropIntent as Intent,
  type Node,
  type NodeId,
  resolveDropIntent,
  Store,
  stackStrategy,
  stripStrategy,
} from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  type DropIntentContext,
  Provider,
  preserveStoreOrder,
  StrategyRegistryProvider,
  useStack,
  useStore,
  Zone,
} from '../index.js';
import '../styles.css';
import './declarative-drop.css';

const STRATEGIES = { stack: stackStrategy as never, strip: stripStrategy as never };

const ROOT = asNodeId('shelf');
const VIEWPORT = { w: 660, h: 300 };
const SPLIT_CONFIG = { gap: 6 };
const STACK_CONFIG = { headerSize: 26 };

interface Pane {
  id: NodeId;
  title: string;
  /** Explicit width, so `CustomDropIntent` has a pane of each size. */
  width?: number;
}

const PANES: Pane[] = [
  { id: asNodeId('alpha'), title: 'Alpha' },
  { id: asNodeId('bravo'), title: 'Bravo' },
  { id: asNodeId('charlie'), title: 'Charlie' },
];

const NARROW_PANES: Pane[] = [
  { id: asNodeId('alpha'), title: 'Alpha' },
  { id: asNodeId('bravo'), title: 'Bravo (wide)' },
  { id: asNodeId('charlie'), title: 'Sliver', width: 90 },
];

/** Stacking buries a pane behind a tab strip, which a 90px sliver has no room
 *  to show. Everything else is the shipped hit-test — a custom resolver is
 *  usually one call plus a rule, not a reimplementation. */
const MIN_STACK_W = 160;

function noStackOnSlivers({ rects, point, axis }: DropIntentContext): Intent {
  const intent = resolveDropIntent(rects, point, axis, { stack: true, split: true });
  if (intent.kind !== 'stack') return intent;
  const onto = rects.find((r) => r.id === intent.ontoId);
  if (onto && onto.rect.w < MIN_STACK_W) return resolveDropIntent(rects, point, axis, {});
  return intent;
}

function PaneBody({ id, title }: { id: NodeId; title: string }) {
  return (
    <DragHandle nodeId={id} className="dd-pane">
      <header className="dd-pane__title" data-testid={`grip-${id}`}>
        {title}
      </header>
      <div className="dd-pane__body">Drop me on a seam, an edge, or a middle.</div>
    </DragHandle>
  );
}

/** The tab strip a stack needs, or its children are unreachable. */
function Tabs({ id }: { id: NodeId }) {
  const { tabs, activeId, activate } = useStack(id);
  return (
    <div className="dd-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          type="button"
          key={t.id}
          role="tab"
          className="dd-tab"
          aria-selected={t.id === activeId}
          tabIndex={t.id === activeId ? 0 : -1}
          data-testid={`tab-${t.id}`}
          onClick={() => activate(t.id)}
        >
          {t.title}
        </button>
      ))}
    </div>
  );
}

/** Every container as `id:child,child`, so a spec can assert the nesting a
 *  drop produced without reaching into the store. */
function Readout() {
  const store = useStore();
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const snapshot = useCallback(() => {
    const walk = (id: NodeId): string[] => {
      const node = store.getNode(id);
      if (!node?.container) return [];
      const kids = node.container.childOrder;
      return [`${id}:${kids.join(',')}`, ...kids.flatMap(walk)];
    };
    return walk(ROOT).join(' ');
  }, [store]);
  const text = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <p className="dd-readout">
      Tree:{' '}
      <span className="dd-readout__value" data-testid="dd-readout">
        {text}
      </span>
    </p>
  );
}

interface ShelfProps {
  panes?: Pane[];
  /** Replaces the built-in hit-test on the shelf and on every nested group. */
  intent?: (ctx: DropIntentContext) => Intent | undefined;
}

function Shelf({ panes = PANES, intent }: ShelfProps = {}) {
  const store = useStore();
  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => <PaneBody id={node.id} title={String(node.meta?.title ?? node.id)} />,
    }),
    [],
  );

  // The zone is JSX-owned; its panes are not. A drop that stacks or splits
  // re-parents a pane under a container the store made, and a preset can only
  // adopt a node it created itself — so the panes are the store's.
  useEffect(() => {
    if (!store.getNode(ROOT)) return;
    for (const pane of panes) {
      if (store.getNode(pane.id)) continue;
      store.registerNode(
        createNode({
          id: pane.id,
          kind: 'panel',
          focus: true,
          parentId: ROOT,
          hints: { minSize: { w: 40, h: 30 } },
          ...(pane.width ? { placement: { size: { w: pane.width } } } : {}),
          meta: { title: pane.title },
        }),
      );
      store.showNode(pane.id);
    }
  }, [store, panes]);

  const renderNested = useCallback(
    (node: Node) => {
      if (!node.container)
        return <PaneBody id={node.id} title={String(node.meta?.title ?? node.id)} />;
      const isStack = node.container.strategyId === 'stack';
      return (
        <div className="dd-nested">
          {isStack ? <Tabs id={node.id} /> : null}
          <Container
            parentId={node.id}
            chrome={chrome}
            stackOnDrop
            splitOnDrop
            affordances
            className="windease-zone dd-nested__zone"
            {...(intent ? { dropIntent: intent } : {})}
          />
        </div>
      );
    },
    [chrome, intent],
  );

  return (
    <Zone
      id={ROOT}
      strategyId="strip"
      config={{ axis: 'x', gap: 6, padding: 6, fill: true }}
      viewport={VIEWPORT}
      className="windease-zone dd-zone"
      sort={preserveStoreOrder}
      acceptsDrops
      stackOnDrop
      splitOnDrop
      affordances
      renderImperative={renderNested}
      {...(intent ? { dropIntent: intent } : {})}
    />
  );
}

export const DropIntent: Story = () => {
  const store = useMemo(() => new Store(), []);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider splitConfig={SPLIT_CONFIG} stackConfig={STACK_CONFIG}>
          <div className="dd-frame">
            <Shelf />
          </div>
          <Readout />
          <div className="dd-prose">
            <p>
              The shelf is a <code>&lt;Zone&gt;</code> holding <code>&lt;Panel&gt;</code>s — no{' '}
              <code>&lt;Container&gt;</code> at the top. Drag a pane by its header onto a{' '}
              <b>left or right seam</b> to insert it there, onto a pane's <b>middle</b> to stack the
              two into tabs, or onto its <b>top or bottom edge</b> to split that slot.
            </p>
          </div>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

/**
 * The same shelf with `dropIntent` replacing the hit-test: a stack is refused
 * onto anything under 160px wide and becomes an insert beside it instead. The
 * `Sliver` sits at 90px, so its middle behaves like its seam.
 */
export const CustomDropIntent: Story = () => {
  const store = useMemo(() => new Store(), []);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider splitConfig={SPLIT_CONFIG} stackConfig={STACK_CONFIG}>
          <div className="dd-frame">
            <Shelf panes={NARROW_PANES} intent={noStackOnSlivers} />
          </div>
          <Readout />
          <div className="dd-prose">
            <p>
              Drop <b>Alpha</b> on the middle of <b>Bravo</b> and the two stack, as they would
              without the override. Drop it on the middle of the <b>Sliver</b> and it inserts beside
              it — the rule refuses a stack onto a pane too narrow to show a tab strip. The resolver
              is the shipped <code>resolveDropIntent</code> called twice, once with stacking on and
              once with it off.
            </p>
          </div>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
