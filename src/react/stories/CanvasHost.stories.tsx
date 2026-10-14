export default { title: 'Canvas host' };

import type { Story } from '@ladle/react';
import { useEffect, useMemo, useRef } from 'react';
import { asNodeId, createNode, gridStrategy, type Rect, Store } from '../../index.js';
import {
  type ChromeMap,
  Container,
  FocusProvider,
  GeometryProvider,
  Provider,
  StrategyRegistryProvider,
  useFocusedNode,
  useStore,
} from '../index.js';
import './windease.css';
import './canvas-host.css';

const STRATEGIES = { grid: gridStrategy as never };
const ZONE = asNodeId('scene');
const VIEWPORT = { w: 600, h: 300 };
const TILES = ['Top', 'Front', 'Side', 'Camera'];

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      container: { strategyId: 'grid', config: { cols: 2, gap: 8, padding: 8 } },
      id: ZONE,
    }),
  );
  for (const title of TILES) {
    const id = asNodeId(`view-${title.toLowerCase()}`);
    s.registerNode(createNode({ kind: 'panel', focus: true, id, parentId: ZONE, meta: { title } }));
    s.showNode(id);
  }
  return s;
}

/** Nothing to draw: the wrapper `<Container>` gives each child is the proxy. */
const PROXIES: ChromeMap = { panel: () => null };

/** One canvas for the whole zone, painted from the placements the strategy
 *  produced. The focus ring is drawn here too, since the proxies are invisible. */
function Scene({ placements }: { placements: ReadonlyMap<string, Rect> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const store = useStore();
  const focused = useFocusedNode()?.id;
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, VIEWPORT.w, VIEWPORT.h);
    ctx.font = '13px system-ui, sans-serif';
    for (const [id, r] of placements) {
      ctx.fillStyle = id === focused ? '#dbeafe' : '#e2e8f0';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      if (id === focused) {
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      }
      ctx.fillStyle = '#0f172a';
      ctx.fillText(String(store.getNode(asNodeId(id))?.meta?.title ?? id), r.x + 10, r.y + 22);
    }
  }, [placements, focused, store]);
  return (
    <canvas
      ref={ref}
      className="ch-canvas"
      width={VIEWPORT.w}
      height={VIEWPORT.h}
      data-testid="scene"
      data-focused={focused ?? ''}
      aria-hidden="true"
    />
  );
}

/**
 * A host that paints every pane into one canvas has no element per pane, so
 * nothing to focus and nothing for a screen reader to find. `<Container>` with
 * chrome that draws nothing supplies both: its child wrappers are invisible,
 * positioned from the same placements, and carry the role, the name, the tab
 * stop and the arrow keys.
 */
export const FocusProxiesOverACanvas: Story = () => {
  const store = useMemo(makeStore, []);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <GeometryProvider>
          <FocusProvider>
            <Container
              parentId={ZONE}
              chrome={PROXIES}
              viewport={VIEWPORT}
              className="windease-zone ch-zone"
              settleMs={0}
              overlay={({ placements }) => <Scene placements={placements} />}
            />
            <p className="ch-prose">
              The four tiles are pixels in one canvas. Press <kbd>Tab</kbd> to enter the zone and
              the arrow keys to move between tiles, or click one: the focus ring is painted by the
              canvas from the store's focused node.
            </p>
          </FocusProvider>
        </GeometryProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
