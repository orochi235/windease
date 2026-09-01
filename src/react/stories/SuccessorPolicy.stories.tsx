export default { title: 'Policies/Focus successor' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import {
  asNodeId,
  createNode,
  type NodeId,
  Store,
  type SuccessorInput,
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
  useStore,
} from '../index.js';
import '../styles.css';
import './policies.css';

const STRATEGIES = { strip: stripStrategy as never };

const ROOT = asNodeId('root');
const HOME = asNodeId('home');

const SEED: Array<[NodeId, string]> = [
  [HOME, 'Home'],
  [asNodeId('alpha'), 'Alpha'],
  [asNodeId('bravo'), 'Bravo'],
  [asNodeId('charlie'), 'Charlie'],
];

function makeStore(chooseSuccessor?: (ctx: SuccessorInput) => NodeId | null | undefined): Store {
  const s = new Store(chooseSuccessor ? { chooseSuccessor } : {});
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
  s.focusNode(asNodeId('bravo'));
  return s;
}

/**
 * Sends focus home when a pane is destroyed, but defers on a hide — closing a
 * tab and collapsing one are different gestures and want different successors.
 * Defers too when Home is what departed, since it has no answer then.
 */
function homeOnDestroy(ctx: SuccessorInput): NodeId | null | undefined {
  if (ctx.reason !== 'destroyed') return undefined;
  if (ctx.departing === HOME) return undefined;
  return ctx.store.getNode(HOME) ? HOME : undefined;
}

function Focused() {
  const node = useFocusedNode();
  return (
    <p className="pol-readout">
      focused: <code>{node ? String(node.meta?.title ?? node.id) : '(nobody)'}</code>
    </p>
  );
}

function Pane({ id, title }: { id: NodeId; title: string }) {
  const store = useStore();
  return (
    <div className={id === HOME ? 'pol-pane pol-pane--home' : 'pol-pane'}>
      <header className="pol-pane__title">
        {title}
        <span>
          <button
            type="button"
            className="pol-pane__close"
            data-testid={`hide-${id}`}
            title="hide (reason: hidden)"
            onClick={() => store.hideNode(id)}
          >
            –
          </button>{' '}
          <button
            type="button"
            className="pol-pane__close"
            data-testid={`close-${id}`}
            title="destroy (reason: destroyed)"
            onClick={() => store.unregisterNode(id)}
          >
            ✕
          </button>
        </span>
      </header>
      <div className="pol-pane__body">{String(id)}</div>
    </div>
  );
}

function Board({ label, note }: { label: string; note: string }) {
  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => <Pane id={node.id} title={String(node.meta?.title ?? node.id)} />,
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

export const SendingFocusHome: Story = () => {
  const builtin = useMemo(() => makeStore(), []);
  const custom = useMemo(() => makeStore(homeOnDestroy), []);

  return (
    <StrategyRegistryProvider strategies={STRATEGIES}>
      <div className="pol-row">
        <Provider store={builtin}>
          <GeometryProvider>
            <FocusProvider>
              <Board label="Built-in" note="no chooseSuccessor" />
            </FocusProvider>
          </GeometryProvider>
        </Provider>
        <Provider store={custom}>
          <GeometryProvider>
            <FocusProvider>
              <Board label="Custom" note="chooseSuccessor: Home on destroy" />
            </FocusProvider>
          </GeometryProvider>
        </Provider>
      </div>
      <div className="pol-prose">
        <p>
          Both boards start with focus on <code>Bravo</code>. Close it with the ✕. The built-in rule
          walks to the next visible sibling, so focus lands on <code>Charlie</code>; the custom{' '}
          <code>chooseSuccessor</code> returns <code>Home</code> instead, which is the pattern an
          editor uses when closing a tab should return you to the file tree.
        </p>
        <p>
          Close <code>Home</code> itself on the right board and the policy returns{' '}
          <code>undefined</code> — it has no answer once its own target is gone — so the built-in
          decides that one. Deferring is not the same as refusing: returning <code>null</code>{' '}
          focuses nobody, deliberately, and the readout reads <code>(nobody)</code>.
        </p>
        <p>
          The ✕ destroys a pane; the – hides it. The policy branches on <code>reason</code> and only
          claims the destroy, so hiding <code>Bravo</code> on the right board behaves exactly like
          the left one. One policy covers every cause, and defers on the ones it has no opinion
          about.
        </p>
      </div>
    </StrategyRegistryProvider>
  );
};
