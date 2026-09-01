export default { title: 'Accept policy' };

import type { Story } from '@ladle/react';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { asNodeId, createNode, type Node, type NodeId, Store, stripStrategy } from '../../index.js';
import {
  type AcceptContext,
  DragHandle,
  DragProvider,
  Provider,
  StrategyRegistryProvider,
  useDragState,
  useLayoutContext,
  useStore,
  Zone,
} from '../index.js';
import '../styles.css';
import './accept-policy.css';

const STRATEGIES = { strip: stripStrategy as never };

const STRICT = asNodeId('zone-strict');
const LENIENT = asNodeId('zone-lenient');

const VIEWPORT = { w: 260, h: 300 };
const CONFIG = { axis: 'y', gap: 8, padding: 8, fill: true, maxItems: 2 };

const PANES: Array<[NodeId, NodeId, string]> = [
  [asNodeId('strict-1'), STRICT, 'Alpha'],
  [asNodeId('strict-2'), STRICT, 'Bravo'],
  [asNodeId('lenient-1'), LENIENT, 'Charlie'],
  [asNodeId('lenient-2'), LENIENT, 'Delta'],
];

/** Accepts a third item where `maxItems: 2` would refuse, and defers on a
 *  fourth so the strategy gets the last word again. */
function acceptUpToThree(ctx: AcceptContext): boolean | undefined {
  return ctx.items.length <= 3 ? true : undefined;
}

/** The panes are the store's, not the JSX's: a drop re-parents one, and a
 *  preset only renders the children it created itself. */
function useSeededPanes(store: Store): void {
  useEffect(() => {
    if (!store.getNode(STRICT) || !store.getNode(LENIENT)) return;
    for (const [id, parentId, title] of PANES) {
      if (store.getNode(id)) continue;
      store.registerNode(createNode({ kind: 'panel', focus: true, id, parentId, meta: { title } }));
      store.showNode(id);
    }
  }, [store]);
}

function renderPane(node: Node) {
  return (
    <DragHandle nodeId={node.id} className="ap-pane">
      <header className="ap-pane__title" data-testid={`pane-${node.id}`}>
        {String(node.meta?.title ?? node.id)}
        <span className="ap-pane__grip" aria-hidden="true">
          ⋮⋮
        </span>
      </header>
      <div className="ap-pane__body">Drag me across.</div>
    </DragHandle>
  );
}

/** Accepting a drop does not raise the cap: `strip` still lays out `maxItems`
 *  and reports the rest, which would otherwise just vanish. */
function Withheld({ zoneId }: { zoneId: NodeId }) {
  const store = useStore();
  const { unplaced } = useLayoutContext();
  if (unplaced.length === 0) return null;
  const names = unplaced.map((id) => String(store.getNode(id)?.meta?.title ?? id)).join(', ');
  return (
    <p className="ap-withheld" data-testid={`withheld-${zoneId}`}>
      withheld by <code>maxItems</code>: {names}
    </p>
  );
}

function Order({ zoneId }: { zoneId: NodeId }) {
  const store = useStore();
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const snapshot = useCallback(
    () => (store.getNode(zoneId)?.container?.childOrder ?? []).join(','),
    [store, zoneId],
  );
  const text = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <code className="ap-order__value" data-testid={`order-${zoneId}`}>
      {text || '(empty)'}
    </code>
  );
}

function AcceptZone({
  zoneId,
  label,
  note,
  canAccept,
}: {
  zoneId: NodeId;
  label: string;
  note: string;
  canAccept?: (ctx: AcceptContext) => boolean | undefined;
}) {
  const drag = useDragState();
  const hover = drag?.hover ?? null;
  const state = hover && hover.targetId === zoneId ? (hover.accepted ? 'accept' : 'reject') : null;

  return (
    <section className="ap-column">
      <header className="ap-column__header">
        {label}
        <span className="ap-column__note">{note}</span>
      </header>
      <div
        className={state ? `ap-frame ap-frame--${state}` : 'ap-frame'}
        data-testid={`frame-${zoneId}`}
      >
        <Zone
          id={zoneId}
          strategyId="strip"
          config={CONFIG}
          viewport={VIEWPORT}
          acceptsDrops
          className="ap-zone"
          data-testid={zoneId}
          renderImperative={renderPane}
          {...(canAccept ? { canAccept } : {})}
        >
          <Withheld zoneId={zoneId} />
        </Zone>
      </div>
      <p className="ap-order">
        childOrder: <Order zoneId={zoneId} />
      </p>
    </section>
  );
}

function Board() {
  const store = useStore();
  useSeededPanes(store);
  return (
    <div className="ap-row">
      <AcceptZone zoneId={STRICT} label="Strict" note="no canAccept" />
      <AcceptZone
        zoneId={LENIENT}
        label="Lenient"
        note="canAccept: items.length ≤ 3"
        canAccept={acceptUpToThree}
      />
    </div>
  );
}

export const WideningTheCap: Story = () => {
  const store = useMemo(() => new Store(), []);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <Board />
          <div className="ap-prose">
            <p>
              Both zones are <code>strip</code> with <code>maxItems: 2</code> and both are full, so
              the strategy refuses a third pane in either. The right zone passes a{' '}
              <code>canAccept</code> that answers <code>true</code> up to three items — drag a pane
              into it and the frame turns green and the drop lands. Drag one into the left zone and
              the frame turns red and the release does nothing.
            </p>
            <p>
              Move a second pane across and the right zone refuses that one too:{' '}
              <code>canAccept</code> returns <code>undefined</code> at four items, which defers to{' '}
              <code>maxItems</code> again.
            </p>
            <p>
              Acceptance and capacity are separate decisions. A widened zone takes the pane into its{' '}
              <code>childOrder</code>, but <code>strip</code> still places only two and reports the
              rest as unplaced — the banner names them.
            </p>
          </div>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
