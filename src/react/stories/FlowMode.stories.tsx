export default { title: 'Flow mode' };

import type { Story } from '@ladle/react';
import { useMemo, useState } from 'react';
import { asNodeId, createNode, type NodeId, Store, stripStrategy } from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  defaultDragOverlay,
  FocusProvider,
  GeometryProvider,
  Panel,
  Provider,
  StrategyRegistryProvider,
  Zone,
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

  /** Rotating the order is the cheapest way to make the settle transition
   *  visible without a drag — and to show that flow has none. */
  const shuffle = () => {
    const order = store.getNode(ZONE)?.container?.childOrder;
    if (!order || order.length < 2) return;
    store.setChildOrder(ZONE, [...order.slice(1), order[0] as NodeId]);
  };

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
                <button type="button" data-testid="shuffle" onClick={shuffle}>
                  Rotate order
                </button>
                <span>
                  {flow ? 'CSS grid is arranging these' : 'stripStrategy is arranging these'}
                </span>
              </div>
              <div className="cap-stage">
                <Container
                  parentId={ZONE}
                  chrome={chrome}
                  viewport={{ w: 720, h: 460 }}
                  affordances
                  settleMs={260}
                  className={flow ? 'windease-zone cap-flow-grid' : 'windease-zone'}
                />
              </div>
              <p className="cap-hint">
                Both modes get the same <code>affordances</code> and{' '}
                <code>
                  settleMs={'{'}260{'}'}
                </code>
                . Placed, that buys draggable gutters between the panes and a settle transition —
                press <strong>Rotate order</strong> and watch them glide. Ticked, both are simply
                absent: a flow container runs no strategy, so there are no affordances to render,
                and the transition moves <code>left</code>/<code>top</code>, which in-flow panes do
                not have. The props are inert rather than rejected.
              </p>
              <p className="cap-hint">
                What still works either way: dragging, and arrow navigation. The hit-test always
                measured the DOM, and the focus resolver takes rects from a source that measures in
                flow. <code>.cap-flow-grid</code> is a plain{' '}
                <code>repeat(auto-fit, minmax(150px, 1fr))</code>, so narrowing the window rewraps
                for free — which is the thing strip cannot do.
              </p>
            </DragProvider>
          </FocusProvider>
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};

const COLUMN = asNodeId('fp-column');
const RIGHT = asNodeId('fp-right');
const FLOW_PANES = ['fp-a', 'fp-b', 'fp-c'];

/**
 * The same hint on a preset rather than on `<Container>`. The left column is a
 * `<Panel>` that is both a container and in flow — CSS stacks its panes — and
 * arrowing between them is what proves the preset reports their geometry.
 */
export const PresetFlowColumn: Story = () => {
  const store = useMemo(() => new Store(), []);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <GeometryProvider>
          <FocusProvider>
            <div className="cap-stage">
              <Zone
                id={asNodeId('fp-zone')}
                strategyId="strip"
                config={{ axis: 'x', fill: true, gap: 8, padding: 8 }}
                viewport={{ w: 720, h: 460 }}
              >
                <Panel
                  id={COLUMN}
                  container={{ strategyId: 'strip', config: { axis: 'y' } }}
                  hints={{ render: 'flow' }}
                  className="cap-flow-column"
                >
                  {FLOW_PANES.map((id) => (
                    <Panel key={id} id={asNodeId(id)} className="cap-pane" title={id} />
                  ))}
                </Panel>
                <Panel id={RIGHT} className="cap-pane" title="placed sibling" />
              </Zone>
            </div>
            <p className="cap-hint">
              The left column runs no strategy — <code>.cap-flow-column</code> stacks its three
              panes. Click one and arrow up or down to move within the column, or right to cross to
              the placed sibling: the resolver scores all four from one coordinate space, because
              the flow preset measures its children instead of placing them.
            </p>
          </FocusProvider>
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
