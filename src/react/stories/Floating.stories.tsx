export default { title: 'Floating' };

import type { Story } from '@ladle/react';
import { useMemo, useState } from 'react';
import {
  asNodeId,
  type Corner,
  createNode,
  floatingStrategy,
  gridStrategy,
  Store,
} from '../../index.js';
import { type ChromeMap, Container, Provider, StrategyRegistryProvider } from '../index.js';
import './floating.css';
import './windease.css';

const STRATEGIES = {
  floating: floatingStrategy(gridStrategy) as never,
};

const ZONE_ID = asNodeId('floating-zone');
const LEGEND_ID = asNodeId('legend');

interface Args {
  handleSize: number;
  snapToPanes: boolean;
  topLeft: boolean;
  topRight: boolean;
  bottomLeft: boolean;
  bottomRight: boolean;
}

function cornersFrom(args: Args): Corner[] {
  const on: Corner[] = [];
  if (args.topLeft) on.push('top-left');
  if (args.topRight) on.push('top-right');
  if (args.bottomLeft) on.push('bottom-left');
  if (args.bottomRight) on.push('bottom-right');
  return on;
}

/** `corners` arrives joined, so the memo depends on a value rather than a new array each render. */
function useZoneStore(handleSize: number, snapToPanes: boolean, corners: string): Store {
  return useMemo(() => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: {
          strategyId: 'floating',
          config: {
            cols: 2,
            gap: 8,
            padding: 8,
            handleSize,
            snapToPanes,
            inset: 12,
            snapThreshold: 12,
          },
        },
        id: ZONE_ID,
      }),
    );
    for (let i = 0; i < 4; i++) {
      const id = asNodeId(`panel-${i + 1}`);
      s.registerNode(
        createNode({
          kind: 'panel',
          focus: true,
          id,
          parentId: ZONE_ID,
          meta: { title: `Pane ${i + 1}` },
        }),
      );
      s.showNode(id);
    }
    // Registered last, so it renders last: nothing in `LayoutResult` carries
    // stacking order, and DOM order is what puts it over the tiles.
    s.registerNode(
      createNode({
        kind: 'legend',
        id: LEGEND_ID,
        parentId: ZONE_ID,
        // An empty list means "every corner" — the same fallback a bad value gets.
        placement: {
          floating: true,
          snapCorners: corners.length > 0 ? corners.split(',') : undefined,
        },
        hints: { preferredSize: { w: 180, h: 110 } },
      }),
    );
    s.showNode(LEGEND_ID);
    return s;
  }, [handleSize, snapToPanes, corners]);
}

function FloatingZone(args: Args) {
  const corners = cornersFrom(args);
  const store = useZoneStore(args.handleSize, args.snapToPanes, corners.join(','));
  const [clicks, setClicks] = useState(0);
  const { handleSize, snapToPanes } = args;

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => <div className="story-panel">{String(node.meta?.title ?? node.id)}</div>,
      legend: () => (
        <div className="floating-legend">
          <div className="floating-legend__body">
            <span>
              handle <strong>{handleSize === 0 ? 'whole panel' : `${handleSize}px band`}</strong>
            </span>
            <span>
              snaps to <strong>{snapToPanes ? 'panes + zone' : 'zone'}</strong>
            </span>
            <button
              type="button"
              className="floating-legend__button"
              data-testid="legend-button"
              onClick={() => setClicks((c) => c + 1)}
            >
              clicked <span data-testid="legend-clicks">{clicks}</span>
            </button>
          </div>
        </div>
      ),
    }),
    [handleSize, snapToPanes, clicks],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        {/* The drag zone is painted by CSS off `data-affordance-kind`, so the
            hit area the strategy emitted is what you see, not a guess at it. */}
        <div className="floating-stage">
          {/* No `viewport`: the zone measures its own content box, so the
              container the strategy places against is exactly what renders. */}
          <Container
            parentId={ZONE_ID}
            chrome={chrome}
            affordances={true}
            className="windease-zone"
          />
        </div>
        <p className="floating-hint">
          The blue wash is the drag handle. Snapping corners:{' '}
          <strong>
            {corners.length === 4 || corners.length === 0 ? 'all four' : corners.join(', ')}
          </strong>
          , capturing within 12px of {args.snapToPanes ? 'a pane or the zone' : 'the zone'}.
        </p>
      </StrategyRegistryProvider>
    </Provider>
  );
}

/** A title-bar band drags, and the panel's own button stays clickable. */
export const HandleBand: Story<Args> = (args) => <FloatingZone {...args} />;
HandleBand.args = {
  handleSize: 24,
  snapToPanes: false,
  topLeft: false,
  topRight: true,
  bottomLeft: true,
  bottomRight: true,
};

/** The default `handleSize` of 0: the handle covers the panel and eats its clicks. */
export const WholePanelHandle: Story<Args> = (args) => <FloatingZone {...args} />;
WholePanelHandle.args = { ...HandleBand.args, handleSize: 0 };

/** Every pane corner is a snap target too, not just the zone's four. */
export const SnapToPanes: Story<Args> = (args) => <FloatingZone {...args} />;
SnapToPanes.args = {
  handleSize: 24,
  snapToPanes: true,
  topLeft: true,
  topRight: true,
  bottomLeft: true,
  bottomRight: true,
};
