export default { title: 'Flow mode' };

import type { Story } from '@ladle/react';
import { useMemo, useState } from 'react';
import { asNodeId, createNode, Store, stripStrategy } from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  defaultDragOverlay,
  FocusProvider,
  GeometryProvider,
  Provider,
  StrategyRegistryProvider,
} from '../index.js';
import '../styles.css';
import './capabilities.css';

const STRATEGIES = { strip: stripStrategy as never };
const ZONE = asNodeId('zone');
const TITLES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];

function makeStore(flow: boolean): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: ZONE,
      container: { strategyId: 'strip', config: { axis: 'x', fill: true, gap: 8, padding: 8 } },
      ...(flow ? { hints: { render: 'flow' as const } } : {}),
    }),
  );
  s.showNode(ZONE);
  for (const title of TITLES) {
    const nid = asNodeId(title.toLowerCase());
    s.registerNode(
      createNode({ kind: 'panel', focus: true, id: nid, parentId: ZONE, meta: { title } }),
    );
    s.showNode(nid);
  }
  return s;
}

/**
 * Remounting on the toggle is the story: `hints.render` is read at layout
 * time, so the same tree renders either way and the difference on screen is
 * entirely who did the arranging.
 */
export const FlowVersusPlaced: Story = () => {
  const [flow, setFlow] = useState(true);
  const store = useMemo(() => makeStore(flow), [flow]);

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => (
        <DragHandle nodeId={node.id} className="cap-pane">
          <header className="cap-pane__title">
            {String(node.meta?.title ?? node.id)}
            <span className="cap-grip" aria-hidden="true">
              ⋮⋮
            </span>
          </header>
          <div className="cap-pane__body">drag me, or arrow between us</div>
        </DragHandle>
      ),
    }),
    [],
  );

  return (
    <Provider store={store} key={String(flow)}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <GeometryProvider>
          <FocusProvider>
            <DragProvider dragOverlay={defaultDragOverlay}>
              <div className="cap-bar">
                <label>
                  <input
                    type="checkbox"
                    checked={flow}
                    data-testid="flow-toggle"
                    onChange={(e) => setFlow(e.target.checked)}
                  />{' '}
                  <code>hints.render: 'flow'</code>
                </label>
                <span>
                  {flow ? 'CSS grid is arranging these' : 'stripStrategy is arranging these'}
                </span>
              </div>
              <div className="cap-stage">
                <Container
                  parentId={ZONE}
                  chrome={chrome}
                  viewport={{ w: 720, h: 460 }}
                  className={flow ? 'windease-zone cap-flow-grid' : 'windease-zone'}
                />
              </div>
              <p className="cap-hint">
                Flow runs no strategy: the panes are ordinary in-flow children and{' '}
                <code>.cap-flow-grid</code> — a plain{' '}
                <code>repeat(auto-fit, minmax(150px, 1fr))</code> — arranges them, so narrowing the
                window rewraps them for free. Drag and arrow navigation work either way, because the
                hit-test always measured the DOM and the focus resolver takes rects from a source
                that measures in flow. What you give up is everything downstream of the strategy: no
                gutters, no <code>unplaced</code>, no settle animation. Untick to hand the same tree
                back to <code>stripStrategy</code>.
              </p>
            </DragProvider>
          </FocusProvider>
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
