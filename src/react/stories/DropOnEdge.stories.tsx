export default { title: 'Drop on edge' };

import type { Story } from '@ladle/react';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { asNodeId, createNode, type NodeId, Store, stripStrategy } from '../../index.js';
import {
  type ChromeMap,
  Container,
  DragHandle,
  DragProvider,
  Provider,
  StrategyRegistryProvider,
  useStore,
} from '../index.js';
import '../styles.css';
import './drop-on-edge.css';

const STRATEGIES = { strip: stripStrategy as never };

const ROOT = asNodeId('workbench');
const VIEWPORT = { w: 660, h: 300 };
/** The strip a split creates. `resizable` is strip's own default, so the new
 *  seam drags without asking; `gap` just makes the seam visible. */
const SPLIT_CONFIG = { gap: 6 };

const PANES = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Bravo' },
  { id: 'c', title: 'Charlie' },
];

function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      id: ROOT,
      kind: 'zone',
      container: {
        strategyId: 'strip',
        config: { axis: 'x', gap: 6, padding: 6, fill: true },
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
        hints: { minSize: { w: 40, h: 30 } },
        meta: { title: pane.title },
      }),
    );
    s.showNode(id);
  }
  return s;
}

/** Every container in the tree as `id:child,child`, so a spec can assert the
 *  nesting a split produced without reaching into the store. */
function Readout() {
  const store = useStore();
  const subscribe = useCallback((cb: () => void) => store.subscribe(cb), [store]);
  const snapshot = useCallback(() => {
    const walk = (id: NodeId): string[] => {
      const node = store.getNode(id);
      if (!node?.container) return [];
      const kids = node.container.childOrder;
      return [`${id}:${kids.join(',')}`, ...kids.flatMap(walk)];
    };
    return walk(ROOT).join(' ');
  }, [store]);
  const text = useSyncExternalStore(subscribe, snapshot, snapshot);
  return (
    <p className="doe-readout">
      Tree:{' '}
      <span className="doe-readout__value" data-testid="doe-readout">
        {text}
      </span>
    </p>
  );
}

const PREVIEW_MODES = ['layout', 'element', 'none'] as const;
type PreviewMode = (typeof PREVIEW_MODES)[number];

export const SplitOnDrop: Story = () => {
  const store = useMemo(() => makeStore(), []);
  const [mode, setMode] = useState<PreviewMode>('layout');

  const chrome: ChromeMap = useMemo(
    () => ({
      panel: ({ node }) => (
        <DragHandle nodeId={node.id} className="doe-panel">
          <header className="doe-panel__title" data-testid={`pane-${node.id}`}>
            {String(node.meta?.title ?? node.id)}
          </header>
          <div className="doe-panel__body">Drop me on a pane's top or bottom edge.</div>
        </DragHandle>
      ),
      group: ({ node }) => (
        <div className="doe-group" data-testid={`group-${node.id}`}>
          <Container
            parentId={node.id}
            chrome={chrome}
            splitOnDrop
            splitPreview={mode}
            affordances
          />
        </div>
      ),
    }),
    [mode],
  );

  return (
    <Provider store={store}>
      <StrategyRegistryProvider strategies={STRATEGIES}>
        <DragProvider splitConfig={SPLIT_CONFIG}>
          <div className="doe-frame">
            <Container
              parentId={ROOT}
              chrome={chrome}
              viewport={VIEWPORT}
              splitOnDrop
              splitPreview={mode}
              affordances
              className="windease-zone doe-zone"
            />
          </div>
          <fieldset className="doe-modes">
            <legend>splitPreview</legend>
            {PREVIEW_MODES.map((m) => (
              <label key={m} className="doe-modes__option">
                <input
                  type="radio"
                  name="splitPreview"
                  value={m}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                  data-testid={`mode-${m}`}
                />
                {m}
              </label>
            ))}
          </fieldset>
          <Readout />
          <div className="doe-prose">
            <p>
              Drag a pane by its header onto the <b>top or bottom edge</b> of another: that pane's
              slot becomes a two-pane column holding both. Drop near a <b>left or right</b> edge
              instead and it inserts beside it, as it always did.
            </p>
            <p>
              The shaded band shows which half the drop would take. Under <code>layout</code>, the
              default, the target pane also shrinks to the half it will actually get, so the hover
              shows the real post-drop geometry; <code>element</code> only shades, and{' '}
              <code>none</code> leaves the drawing to you.
            </p>
            <p>
              The new seam drags. Drag either pane back out and the pair dissolves, lifting the
              survivor into the row.
            </p>
          </div>
        </DragProvider>
      </StrategyRegistryProvider>
    </Provider>
  );
};
