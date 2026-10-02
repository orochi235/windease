export default { title: 'Repel' };

import type { Story } from '@ladle/react';
import { useEffect, useMemo, useState } from 'react';
import {
  ANCHORS,
  type Anchor,
  anchorOrigin,
  asNodeId,
  createNode,
  repelStrategy,
  Store,
} from '../../index.js';
import { type ChromeMap, Container, Provider, StrategyRegistryProvider } from '../index.js';
import './repel.css';
import './windease.css';

const STRATEGIES = { repel: repelStrategy as never };

const ZONE_ID = asNodeId('repel-zone');
const STAGE = { x: 0, y: 0, z: 0, w: 480, h: 360 };
const SIZE = { w: 120, h: 72 };
const INSET = 12;

type Drift = 'unbounded' | '0' | '60';

interface Args {
  gap: number;
  drift: Drift;
}

const driftOf = (d: Drift) => (d === 'unbounded' ? undefined : Number(d));

function addWindow(store: Store, anchor: Anchor) {
  const n = (store.getContainerView(ZONE_ID)?.childOrder.length ?? 0) + 1;
  const id = asNodeId(`win-${n}`);
  const want = anchorOrigin(anchor, SIZE, STAGE, INSET);
  store.registerNode(
    createNode({
      kind: 'window',
      id,
      parentId: ZONE_ID,
      placement: { x: want.x, y: want.y },
      meta: { title: `${n} · ${anchor}` },
      hints: { preferredSize: SIZE },
    }),
  );
  store.showNode(id);
}

function clear(store: Store) {
  for (const id of [...(store.getContainerView(ZONE_ID)?.childOrder ?? [])]) {
    store.unregisterNode(id);
  }
}

const chrome: ChromeMap = {
  window: ({ node }) => <div className="repel-window">{String(node.meta?.title ?? node.id)}</div>,
};

function RepelZone({ gap, drift }: Args) {
  const store = useMemo(() => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        id: ZONE_ID,
        container: { strategyId: 'repel', config: {} },
      }),
    );
    return s;
  }, []);
  // Args patch the config in place, so the windows survive a tweak.
  useEffect(() => {
    store.updateContainerConfig(ZONE_ID, { gap, drift: driftOf(drift) });
  }, [store, gap, drift]);
  const [anchor, setAnchor] = useState<Anchor>('center');

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="repel-stage">
          <Container
            parentId={ZONE_ID}
            chrome={chrome}
            viewport={STAGE}
            className="windease-zone"
          />
        </div>
        <div className="repel-controls">
          <label>
            Anchor{' '}
            <select
              data-testid="anchor"
              value={anchor}
              onChange={(e) => setAnchor(e.target.value as Anchor)}
            >
              {ANCHORS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <button type="button" data-testid="add" onClick={() => addWindow(store, anchor)}>
            Add a window
          </button>
          <button type="button" data-testid="clear" onClick={() => clear(store)}>
            Clear
          </button>
        </div>
        <p className="repel-hint">
          Each window asks for the spot <code>anchorOrigin</code> gives its anchor. Add several at
          one anchor: the first gets the spot, and each later one moves to the nearest place that
          keeps {gap}px from the rest
          {drift === 'unbounded' ? '' : `, or stays and overlaps when that is over ${drift}px away`}
          .
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/** Windows ask for the same spot and are pushed apart, nearest free spot first. */
export const Repel: Story<Args> = (args) => <RepelZone {...args} />;
Repel.args = { gap: 8, drift: 'unbounded' };
Repel.argTypes = { drift: { options: ['unbounded', '0', '60'], control: { type: 'radio' } } };

/** `drift: 0`: nothing moves, so windows that ask for one spot stack on it. */
export const NoDrift: Story<Args> = (args) => <RepelZone {...args} />;
NoDrift.args = { gap: 8, drift: '0' };
NoDrift.argTypes = Repel.argTypes;
