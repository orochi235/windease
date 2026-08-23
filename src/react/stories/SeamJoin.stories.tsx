export default { title: 'Seam join' };

import type { Story } from '@ladle/react';
import { useMemo } from 'react';
import { asNodeId, createNode, Store, stripStrategy } from '../../index.js';
import {
  type ChromeMap,
  Container,
  Provider,
  StrategyRegistryProvider,
  useChildren,
} from '../index.js';
import '../styles.css';
import './seam-join.css';

const STRATEGIES = { strip: stripStrategy as never };

const ROOT = asNodeId('workbench');
const PANE_W = 240;
const PANE_MIN_W = 80;
const GAP = 8;
const PADDING = 8;
/** Sized so the three panes start at exactly `PANE_W`: strip sizes a pane with
 *  no declared size to its floor, and a fixture that starts pinned arms at once. */
const VIEWPORT = { w: 3 * PANE_W + 2 * GAP + 2 * PADDING, h: 240 };

const PANES: Array<{ id: string; title: string; lockDestroy?: true }> = [
  { id: 'editor', title: 'Editor' },
  { id: 'preview', title: 'Preview' },
  { id: 'console', title: 'Console', lockDestroy: true },
];

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      id: ROOT,
      kind: 'zone',
      container: {
        strategyId: 'strip',
        config: {
          axis: 'x',
          gap: GAP,
          padding: PADDING,
          resizeMode: 'neighbor',
          joinOnOvershoot: true,
          joinThreshold: 24,
        },
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
        placement: { size: { w: PANE_W } },
        hints: { minSize: { w: PANE_MIN_W, h: 0 } },
        meta: { title: pane.title },
        ...(pane.lockDestroy ? { lock: { destroy: true } } : {}),
      }),
    );
    s.showNode(id);
  }
  return s;
}

function Readout() {
  const children = useChildren(ROOT);
  return (
    <p className="sj-readout">
      Still open:{' '}
      <span className="sj-readout__value" data-testid="sj-readout">
        {children.length === 0
          ? '(nothing)'
          : children.map((n) => String(n.meta?.title ?? n.id)).join(', ')}
      </span>
    </p>
  );
}

const chrome: ChromeMap = {
  panel: ({ node }) => (
    <div className="sj-panel">
      <header className="sj-panel__title">{String(node.meta?.title ?? node.id)}</header>
      {node.lock?.destroy ? (
        <p className="sj-panel__note">
          Destroy-locked. Its seam still resizes down to the floor, but the gesture never arms.
        </p>
      ) : (
        <p className="sj-panel__note">Floor: {PANE_MIN_W}px.</p>
      )}
    </div>
  ),
};

export const JoinOnOvershoot: Story = () => {
  const store = useMemo(() => makeStore(), []);
  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <div className="sj-frame">
          <Container
            parentId={ROOT}
            chrome={chrome}
            viewport={VIEWPORT}
            affordances
            className="windease-zone sj-zone"
          />
        </div>
        <Readout />
        <div className="sj-prose">
          <p>
            Drag the seam between <b>Editor</b> and <b>Preview</b> to the right. Preview shrinks to
            its 80px floor and the seam stops — keep pushing another 24px and the gesture arms:
            Preview is hatched and the seam thickens. Release there and Preview is closed. Back off
            under 24px, or press <kbd>Escape</kbd> mid-drag, and nothing is destroyed.
          </p>
          <p>
            From the keyboard: <kbd>Tab</kbd> to a seam, then <kbd>→</kbd> past the floor until it
            arms. <kbd>Enter</kbd> closes the pane, <kbd>Escape</kbd> or <kbd>←</kbd> backs out, and{' '}
            <kbd>End</kbd> goes to the far edge without ever arming.
          </p>
          <p>
            <b>Console</b> is destroy-locked, so the seam to its left resizes normally and refuses
            to arm however far it is pushed.
          </p>
        </div>
      </StrategyRegistryProvider>
    </Provider>
  );
};
