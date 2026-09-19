export default { title: 'Tear out' };

import type { Story } from '@ladle/react';
import { useCallback, useMemo, useRef } from 'react';
import {
  asNodeId,
  createNode,
  type DropIntent,
  floatingStrategy,
  type Node,
  type NodeId,
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
  StrategyRegistryProvider,
  useChildren,
  useDragHandle,
  useStack,
} from '../index.js';
import '../styles.css';
import './tear-out.css';

const STRATEGIES = {
  'floating-strip': floatingStrategy(stripStrategy) as never,
  stack: stackStrategy as never,
};

const STUDIO = asNodeId('studio');
const CANVAS = asNodeId('canvas');
const PANELS = asNodeId('panels');
const HEADER = 30;
const VIEWPORT = { w: 900, h: 480 };

const TABS = [
  { id: 'layers', title: 'Layers' },
  { id: 'channels', title: 'Channels' },
  { id: 'paths', title: 'Paths' },
];

type Size = 'body' | 'fixed';

function makeStore(size: Size): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      id: STUDIO,
      kind: 'zone',
      container: {
        strategyId: 'floating-strip',
        // Takes only tabs torn out of the stack: a floating panel dropped on
        // the canvas is not a move.
        config: { axis: 'x', fill: true, handleSize: 24, accepts: 'tear' },
      },
    }),
  );
  s.registerNode(
    createNode({ id: CANVAS, kind: 'canvas', parentId: STUDIO, meta: { title: 'Canvas' } }),
  );
  s.showNode(CANVAS);
  s.registerNode(
    createNode({
      id: PANELS,
      kind: 'tabs',
      parentId: STUDIO,
      placement: { size: { w: 280 } },
      container: {
        strategyId: 'stack',
        config: {
          headerSize: HEADER,
          tear: 'float',
          show: 'dropped',
          fallback: 'next',
          ...(size === 'fixed' ? { tearSize: { w: 240, h: 200 } } : {}),
        },
      },
    }),
  );
  s.showNode(PANELS);
  for (const tab of TABS) {
    const id = asNodeId(tab.id);
    s.registerNode(
      createNode({ id, kind: 'tab', focus: true, parentId: PANELS, meta: { title: tab.title } }),
    );
    s.showNode(id);
  }
  return s;
}

const isFloating = (node: Node | undefined) => node?.membership?.placement.floating === true;
const titleOf = (node: Node) => String(node.meta?.title ?? node.id);

function Tab({
  id,
  title,
  active,
  onPick,
}: {
  id: NodeId;
  title: string;
  active: boolean;
  onPick: () => void;
}) {
  const drag = useDragHandle(id);
  return (
    <button
      type="button"
      role="tab"
      className="to-tab"
      data-tab={id}
      data-testid={`tab-${id}`}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onPick}
      {...drag}
    >
      {title}
    </button>
  );
}

/** The stack's chrome: a tab strip over the body, which the stack's own `headerSize` leaves room for. */
function PanelStack({ node, chrome }: { node: Node; chrome: ChromeMap }) {
  const { tabs, activeId, activate } = useStack(node.id);
  const stripRef = useRef<HTMLDivElement | null>(null);

  // Only the active tab has a body to measure, so drop between the tab labels instead.
  const dropIntent = useCallback(({ point, sourceId }: DropIntentContext): DropIntent => {
    const labels = [...(stripRef.current?.querySelectorAll<HTMLElement>('[data-tab]') ?? [])];
    const others = labels.filter((el) => el.dataset.tab !== sourceId);
    const index = others.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2 < point.x;
    }).length;
    return { kind: 'insert', index };
  }, []);

  return (
    <div className="to-stack" data-testid="stack">
      <div className="to-tabs" role="tablist" ref={stripRef}>
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            id={tab.id}
            title={tab.title}
            active={tab.id === activeId}
            onPick={() => activate(tab.id)}
          />
        ))}
      </div>
      <Container parentId={node.id} chrome={chrome} dropIntent={dropIntent} settleMs={0} />
    </div>
  );
}

/** A torn-out tab: the top band moves it, the chip under it docks it back. */
function Palette({ node }: { node: Node }) {
  return (
    <div className="to-palette" data-testid={`palette-${node.id}`}>
      <div className="to-palette__bar" />
      <div className="to-palette__tabs">
        <DragHandle nodeId={node.id} className="to-tab to-tab--chip">
          <span data-testid={`chip-${node.id}`}>{titleOf(node)}</span>
        </DragHandle>
      </div>
      <div className="to-palette__body">Drag the tab back into the stack to dock it.</div>
    </div>
  );
}

function Readout() {
  const floating = useChildren(STUDIO)
    .filter(isFloating)
    .map((c) => c.id);
  const docked = useChildren(PANELS).map((c) => c.id);
  return (
    <dl className="to-readout">
      <dt>Floating</dt>
      <dd data-testid="to-floating">{floating.join(' ')}</dd>
      <dt>Docked</dt>
      <dd data-testid="to-docked">{docked.join(' ')}</dd>
    </dl>
  );
}

/**
 * A panel stack docked beside a canvas, as in Photoshop. The stack says `tear: 'float'`, so
 * dragging a tab out onto the canvas floats it there, and dragging it back docks it. No host
 * code moves anything: the drag engine reads the config.
 */
export const TearOut: Story<{ size: Size }> = ({ size }) => {
  const store = useMemo(() => makeStore(size), [size]);

  const chrome: ChromeMap = useMemo(() => {
    const map: ChromeMap = {
      canvas: ({ node }) => (
        <div className="to-canvas" data-testid="canvas">
          {titleOf(node)}
        </div>
      ),
      tabs: ({ node }) => <PanelStack node={node} chrome={map} />,
      tab: ({ node }) =>
        isFloating(node) ? (
          <Palette node={node} />
        ) : (
          <div className="to-page" data-testid={`page-${node.id}`}>
            {titleOf(node)}
          </div>
        ),
    };
    return map;
  }, []);

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider>
          <div className="to-frame">
            <Container
              parentId={STUDIO}
              chrome={chrome}
              viewport={VIEWPORT}
              affordances={true}
              settleMs={0}
              className="windease-zone to-studio"
            />
          </div>
          <Readout />
          <div className="to-prose">
            <p>
              Drag a tab out of the stack onto the canvas and it floats where you let go,{' '}
              {size === 'body'
                ? 'at the size of the tab body'
                : 'at the stack’s configured tearSize of 240×200'}
              . Move it by its top band. Drag its tab chip back onto the stack’s tab strip to dock
              it again.
            </p>
          </div>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
TearOut.args = { size: 'body' };
TearOut.argTypes = {
  size: { options: ['body', 'fixed'], control: { type: 'radio' } },
};
