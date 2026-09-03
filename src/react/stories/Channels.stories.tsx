export default { title: 'Channels' };

import type { Story } from '@ladle/react';
import { useMemo, useState } from 'react';
import {
  asNodeId,
  type LayoutItem,
  type LayoutResult,
  type LayoutStrategy,
  type NodeId,
  type Rect,
  Store,
} from '../../index.js';
import {
  Panel,
  Provider,
  StrategyRegistryProvider,
  useChannelsForSelf,
  Zone,
} from '../index.js';
import './channels.css';
import './windease.css';

/**
 * A row whose children recede: each is a step further back in `z`, and the
 * opacity that sells the recession rides in `channels` — carried from here to
 * the component that renders it without windease reading it.
 */
const recedeStrategy: LayoutStrategy<void, string> = {
  name: 'recede',
  configSpec: { from: ['front', 'back'], gap: 'number' },
  layout({ items, container, options }): LayoutResult<string> {
    const gap = (options.gap as number) ?? 8;
    const from = (options.from as 'front' | 'back') ?? 'front';
    const w = items.length ? (container.w - gap * (items.length - 1)) / items.length : 0;

    const placements = new Map<string, Rect>();
    const channels = new Map<string, Record<string, number>>();

    items.forEach((item: LayoutItem, i: number) => {
      const rank = items.length > 1 ? i / (items.length - 1) : 0;
      const depth = from === 'front' ? rank : 1 - rank;
      placements.set(item.id, { x: i * (w + gap), y: 0, z: depth * 100, w, h: container.h });
      // Floored well above zero, so a receded card is faint but still present.
      channels.set(item.id, { opacity: 1 - depth * 0.8, depth });
    });

    return { placements, affordances: [], channels };
  },
};

const STRATEGIES = { recede: recedeStrategy as never };

/** Reads one number the core carried but never looked at. */
function Card({ id }: { id: NodeId }) {
  const channels = useChannelsForSelf(id);
  const opacity = channels?.opacity;
  return (
    <div
      className="channels-demo__card"
      style={{ '--channel-opacity': opacity ?? 1 } as never}
      data-testid="card"
    >
      {opacity === undefined ? 'no channel' : opacity.toFixed(2)}
    </div>
  );
}

export const RecedingRow: Story = () => {
  const [from, setFrom] = useState<'front' | 'back'>('front');
  const [count, setCount] = useState(5);
  const store = useMemo(() => new Store(), []);
  const ids = Array.from({ length: count }, (_, i) => asNodeId(`card-${i + 1}`));

  return (
    <div className="channels-demo">
      <div className="channels-demo__controls">
        <button type="button" onClick={() => setFrom(from === 'front' ? 'back' : 'front')}>
          fade from: {from}
        </button>
        <button type="button" onClick={() => setCount((c) => Math.min(9, c + 1))}>
          add card
        </button>
        <button type="button" onClick={() => setCount((c) => Math.max(2, c - 1))}>
          remove card
        </button>
        <span className="channels-demo__readout">{count} cards</span>
      </div>

      <Provider store={store}>
        <StrategyRegistryProvider strategies={STRATEGIES}>
          <Zone
            id={asNodeId('channels-zone')}
            strategyId="recede"
            config={{ from, gap: 8 }}
            viewport={{ w: 720, h: 140 }}
          >
            {ids.map((id) => (
              <Panel key={String(id)} id={id}>
                <Card id={id} />
              </Panel>
            ))}
          </Zone>
        </StrategyRegistryProvider>
      </Provider>

      <p className="channels-demo__readout">
        Each card prints the `opacity` its strategy put in `channels`. Flip the
        fade or change the count and the values move — windease recomputed and
        republished them without ever reading one.
      </p>
    </div>
  );
};
