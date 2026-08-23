export default { title: 'Tab stack' };

import type { Story } from '@ladle/react';
import { useCallback, useMemo, useRef } from 'react';
import {
  asNodeId,
  createNode,
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
  Provider,
  StrategyRegistryProvider,
  useChildren,
  useStack,
} from '../index.js';
import '../styles.css';
import './tab-stack.css';

const STRATEGIES = { stack: stackStrategy as never, strip: stripStrategy as never };

const ROOT = asNodeId('workbench');
const HEADER = 28;
const VIEWPORT = { w: 660, h: 260 };
const STACK_CONFIG = { headerSize: HEADER };

const PANES = [
  { id: 'editor', title: 'Editor' },
  { id: 'preview', title: 'Preview' },
  { id: 'console', title: 'Console' },
];

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      id: ROOT,
      kind: 'zone',
      container: {
        strategyId: 'strip',
        config: { axis: 'x', gap: 8, padding: 8, fill: true },
      },
    }),
  );
  for (const pane of PANES) {
    const id = asNodeId(pane.id);
    s.registerNode(
      createNode({
        id,
        kind: 'panel',
        focus: true,
        parentId: ROOT,
        hints: { minSize: { w: 60, h: 0 } },
        meta: { title: pane.title },
      }),
    );
    s.showNode(id);
  }
  return s;
}

/** The tab strip is the consumer's to draw; `useStack` says what to draw. */
function TabStrip({ id }: { id: NodeId }) {
  const { tabs, activeId, activate } = useStack(id);
  const stripRef = useRef<HTMLDivElement | null>(null);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (step === 0) return;
      e.preventDefault();
      const at = tabs.findIndex((t) => t.id === activeId);
      const next = tabs[(at + step + tabs.length) % tabs.length];
      if (!next) return;
      activate(next.id);
      stripRef.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
    },
    [tabs, activeId, activate],
  );

  return (
    <div className="ts-tabs" role="tablist" ref={stripRef} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          data-tab={tab.id}
          data-testid={`tab-${tab.id}`}
          aria-selected={tab.id === activeId}
          tabIndex={tab.id === activeId ? 0 : -1}
          className="ts-tab"
          onClick={() => activate(tab.id)}
        >
          {tab.title}
        </button>
      ))}
    </div>
  );
}

function Readout() {
  const children = useChildren(ROOT);
  const describe = (n: Node): string =>
    n.container ? `[${n.container.childOrder.join(' ')}]` : String(n.id);
  return (
    <p className="ts-readout">
      Tree:{' '}
      <span className="ts-readout__value" data-testid="ts-readout">
        {children.map(describe).join(' ')}
      </span>
    </p>
  );
}

export const StackOnDrop: Story = () => {
  const store = useMemo(() => makeStore(), []);

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => (
        <DragHandle nodeId={node.id} className="ts-panel">
          <header className="ts-panel__title" data-testid={`pane-${node.id}`}>
            {String(node.meta?.title ?? node.id)}
          </header>
          <div className="ts-panel__body">Drag me onto the middle of another pane.</div>
        </DragHandle>
      ),
      group: ({ node }) => (
        <div className="ts-stack" data-testid={`stack-${node.id}`}>
          <TabStrip id={node.id} />
          <Container parentId={node.id} chrome={chrome} />
        </div>
      ),
    }),
    [],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider stackConfig={STACK_CONFIG}>
          <div className="ts-frame">
            <Container
              parentId={ROOT}
              chrome={chrome}
              viewport={VIEWPORT}
              stackOnDrop
              className="windease-zone ts-zone"
            />
          </div>
          <Readout />
          <div className="ts-prose">
            <p>
              Drag a pane by its header onto the <b>middle</b> of another and the two become one
              tabbed stack. Drop near a pane's left or right <b>edge</b> instead and it inserts
              beside it, as it always did.
            </p>
            <p>
              Click a tab to switch, or focus one and use <kbd>←</kbd> <kbd>→</kbd>. Drag the last
              tab back out and the stack dissolves, lifting the survivor into the row.
            </p>
          </div>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
