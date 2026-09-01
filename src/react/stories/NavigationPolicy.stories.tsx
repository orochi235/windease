export default { title: 'Policies/Navigation' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import {
  asNodeId,
  createNode,
  type NodeId,
  type ResolveInput,
  Store,
  stripStrategy,
} from '../../index.js';
import {
  type ChromeMap,
  Container,
  FocusProvider,
  GeometryProvider,
  Provider,
  StrategyRegistryProvider,
  useFocusedNode,
} from '../index.js';
import '../styles.css';
import './policies.css';

const STRATEGIES = { strip: stripStrategy as never };

const ROOT = asNodeId('root');

const SEED: Array<[NodeId, string]> = [
  [asNodeId('alpha'), 'Alpha'],
  [asNodeId('bravo'), 'Bravo'],
  [asNodeId('charlie'), 'Charlie'],
  [asNodeId('delta'), 'Delta'],
];

const ORDER = SEED.map(([id]) => id);

function makeStore(resolveNavigation?: (i: ResolveInput) => NodeId | null | undefined): Store {
  const s = new Store(resolveNavigation ? { resolveNavigation } : {});
  s.registerNode(
    createNode({
      kind: 'zone',
      id: ROOT,
      container: { strategyId: 'strip', config: { axis: 'x', fill: true, gap: 8, padding: 8 } },
    }),
  );
  s.showNode(ROOT);
  for (const [id, title] of SEED) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id, parentId: ROOT, meta: { title } }));
    s.showNode(id);
  }
  s.focusNode(ORDER[0] as NodeId);
  return s;
}

/**
 * Wraps left/right at the ends, where the built-in stops, and declares up/down
 * dead in a row rather than letting geometry find nothing. Every other intent
 * defers.
 */
function wrapAround(input: ResolveInput): NodeId | null | undefined {
  if (input.intent === 'up' || input.intent === 'down') return null;
  if (input.intent !== 'left' && input.intent !== 'right') return undefined;
  const at = ORDER.indexOf(input.from);
  if (at < 0) return undefined;
  const step = input.intent === 'right' ? 1 : -1;
  return ORDER[(at + step + ORDER.length) % ORDER.length];
}

function Focused() {
  const node = useFocusedNode();
  return (
    <p className="pol-readout">
      focused: <code>{node ? String(node.meta?.title ?? node.id) : '(nobody)'}</code>
    </p>
  );
}

function Board({ label, note }: { label: string; note: string }) {
  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => (
        <div className="pol-pane">
          <header className="pol-pane__title">{String(node.meta?.title ?? node.id)}</header>
          <div className="pol-pane__body">{String(node.id)}</div>
        </div>
      ),
    }),
    [],
  );
  return (
    <section className="pol-column">
      <header className="pol-column__header">
        {label}
        <span className="pol-column__note">{note}</span>
      </header>
      <div className="pol-frame">
        <Container parentId={ROOT} chrome={chrome} viewport={{ w: 460, h: 160 }} />
      </div>
      <Focused />
    </section>
  );
}

export const WrappingAtTheEnds: Story = () => {
  const builtin = useMemo(() => makeStore(), []);
  const custom = useMemo(() => makeStore(wrapAround), []);

  return (
    <StrategyRegistryProvider strategies={STRATEGIES}>
      <div className="pol-row">
        <Provider store={builtin}>
          <GeometryProvider>
            <FocusProvider>
              <Board label="Built-in" note="no resolveNavigation" />
            </FocusProvider>
          </GeometryProvider>
        </Provider>
        <Provider store={custom}>
          <GeometryProvider>
            <FocusProvider>
              <Board label="Custom" note="resolveNavigation: wraps, refuses ↑↓" />
            </FocusProvider>
          </GeometryProvider>
        </Provider>
      </div>
      <div className="pol-prose">
        <p>
          Tab into either board and walk across with <kbd>←</kbd> <kbd>→</kbd>. Both start on{' '}
          <code>Alpha</code>. Press <kbd>←</kbd> on the left board and nothing happens — the
          built-in resolves by geometry and there is nothing to the left. The right board's{' '}
          <code>resolveNavigation</code> wraps to <code>Delta</code> instead.
        </p>
        <p>
          Press <kbd>↑</kbd> on the right board and nothing happens either, but for a different
          reason: the policy returns <code>null</code>, which refuses the move outright. Returning{' '}
          <code>undefined</code> would have fallen through to <code>strategy.navigate</code> and
          then to geometry — the distinction is between "there is no answer here" and "do not ask
          anyone else".
        </p>
        <p>
          The id a policy returns has to name a focusable, visible node. One that names something
          else, or throws, is traced on the <code>workspace</code> category and treated as{' '}
          <code>undefined</code>, so a broken policy degrades to the built-in rather than trapping
          the caret.
        </p>
      </div>
    </StrategyRegistryProvider>
  );
};
