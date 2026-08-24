export default { title: 'Floating' };

import type { Story } from '@ladle/react';
import { useMemo, useState } from 'react';
import { asNodeId, createNode, floatingStrategy, gridStrategy, Store } from '../../index.js';
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
}

function useZoneStore(handleSize: number): Store {
  return useMemo(() => {
    const s = new Store();
    s.registerNode(
      createNode({
        kind: 'zone',
        container: {
          strategyId: 'floating',
          config: { cols: 2, gap: 8, padding: 8, handleSize, inset: 12, snapThreshold: 12 },
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
        // `top-left` is excluded, so an excluded corner is visible in the story.
        placement: {
          floating: true,
          snapCorners: ['top-right', 'bottom-left', 'bottom-right'],
        },
        hints: { preferredSize: { w: 180, h: 110 } },
      }),
    );
    s.showNode(LEGEND_ID);
    return s;
  }, [handleSize]);
}

function FloatingZone({ handleSize }: Args) {
  const store = useZoneStore(handleSize);
  const [clicks, setClicks] = useState(0);

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => <div className="story-panel">{String(node.meta?.title ?? node.id)}</div>,
      legend: () => (
        <div className="floating-legend">
          <div className="floating-legend__grip">drag me</div>
          <div className="floating-legend__body">
            <span>
              handleSize <strong>{handleSize}</strong>
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
    [handleSize, clicks],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
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
      </StrategyRegistryProvider>
    </Provider>
  );
}

/** The shipped shape: a title-bar band drags, and the panel's own button works. */
export const HandleBand: Story<Args> = ({ handleSize }) => <FloatingZone handleSize={handleSize} />;
HandleBand.args = { handleSize: 24 };

/** The default `handleSize` of 0: the handle covers the panel and eats its clicks. */
export const WholePanelHandle: Story<Args> = ({ handleSize }) => (
  <FloatingZone handleSize={handleSize} />
);
WholePanelHandle.args = { handleSize: 0 };
