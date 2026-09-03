export default { title: 'Store/Moving several nodes' };

import type { Story } from '@ladle/react';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { asNodeId, createNode, type NodeId, Store, stripStrategy } from '../../index.js';
import {
  type ChromeMap,
  Container,
  FocusProvider,
  GeometryProvider,
  Provider,
  StrategyRegistryProvider,
  useStore,
} from '../index.js';
import '../styles.css';
import './policies.css';

const STRATEGIES = { strip: stripStrategy as never };

const ROOT = asNodeId('root');
const SRC = asNodeId('src');
const DST = asNodeId('dock');

const SOURCE_PANES: Array<[NodeId, string]> = [
  [asNodeId('alpha'), 'Alpha'],
  [asNodeId('bravo'), 'Bravo'],
  [asNodeId('charlie'), 'Charlie'],
  [asNodeId('delta'), 'Delta'],
];

/** `root` › (`src` with four panes, `dock` with one). `src` auto-unsplits. */
function makeStore(): Store {
  const s = new Store();
  s.registerNode(
    createNode({
      kind: 'zone',
      id: ROOT,
      container: { strategyId: 'strip', config: { axis: 'x', fill: true, gap: 8, padding: 8 } },
    }),
  );
  s.showNode(ROOT);
  for (const zone of [SRC, DST]) {
    s.registerNode(
      createNode({
        kind: 'zone',
        id: zone,
        parentId: ROOT,
        container: { strategyId: 'strip', config: { axis: 'y', fill: true, gap: 6, padding: 6 } },
      }),
    );
    s.showNode(zone);
  }
  s.setAutoUnsplit(SRC, true);
  for (const [id, title] of SOURCE_PANES) {
    s.registerNode(createNode({ kind: 'panel', focus: true, id, parentId: SRC, meta: { title } }));
    s.showNode(id);
  }
  const docked = asNodeId('echo');
  s.registerNode(
    createNode({ kind: 'panel', focus: true, id: docked, parentId: DST, meta: { title: 'Echo' } }),
  );
  s.showNode(docked);
  return s;
}

function Pane({
  id,
  title,
  picked,
  onToggle,
}: {
  id: NodeId;
  title: string;
  picked: boolean;
  onToggle: (id: NodeId) => void;
}) {
  return (
    <div className={picked ? 'pol-pane pol-pane--picked' : 'pol-pane'}>
      <header className="pol-pane__title">
        <label>
          <input
            type="checkbox"
            checked={picked}
            data-testid={`pick-${id}`}
            onChange={() => onToggle(id)}
          />{' '}
          {title}
        </label>
      </header>
      <div className="pol-pane__body">{String(id)}</div>
    </div>
  );
}

function Order({ parentId, label }: { parentId: NodeId; label: string }) {
  const store = useStore();
  const read = useCallback(
    () => store.getContainerView(parentId)?.childOrder.join(' ') ?? '(gone)',
    [store, parentId],
  );
  const subscribe = useCallback((fn: () => void) => store.subscribe(fn), [store]);
  const order = useSyncExternalStore(subscribe, read, read);
  return (
    <p className="pol-readout">
      {label}: <code data-testid={`order-${parentId}`}>{order}</code>
    </p>
  );
}

function Board({
  label,
  note,
  batch,
  picked,
  onToggle,
}: {
  label: string;
  note: string;
  batch: boolean;
  picked: ReadonlySet<string>;
  onToggle: (id: NodeId) => void;
}) {
  const store = useStore();
  const [error, setError] = useState('');
  const chrome: ChromeMap = useMemo(() => {
    const map: ChromeMap = {
      zone: ({ node }) => (
        <div className="mv-zone">
          <header className="mv-zone__title">{String(node.id)}</header>
          <Container parentId={node.id} chrome={map} />
        </div>
      ),
      panel: ({ node }) => (
        <Pane
          id={node.id}
          title={String(node.meta?.title ?? node.id)}
          picked={picked.has(String(node.id))}
          onToggle={onToggle}
        />
      ),
    };
    return map;
  }, [picked, onToggle]);

  const run = () => {
    const ids = [...picked].map(asNodeId);
    setError('');
    try {
      if (batch) {
        store.moveNodes(ids, DST, 0);
      } else {
        store.transact(() => {
          for (const id of ids) store.moveNode(id, DST, 0);
        }, 'loop');
      }
    } catch (e) {
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
  };

  return (
    <section className="pol-column">
      <header className="pol-column__header">
        {label}
        <span className="pol-column__note">{note}</span>
      </header>
      <div className="pol-frame">
        <Container parentId={ROOT} chrome={chrome} viewport={{ w: 460, h: 320 }} />
      </div>
      <div className="pol-toolbar">
        <button type="button" data-testid={`move-${batch ? 'batch' : 'loop'}`} onClick={run}>
          Move selection to the top of Dock
        </button>
      </div>
      <Order parentId={SRC} label="src" />
      <Order parentId={DST} label="dock" />
      {error === '' ? null : (
        <p className="pol-readout" data-testid={`error-${batch ? 'batch' : 'loop'}`}>
          <code>{error}</code>
        </p>
      )}
    </section>
  );
}

export const OneBatchVersusALoop: Story = () => {
  const loopStore = useMemo(() => makeStore(), []);
  const batchStore = useMemo(() => makeStore(), []);
  const [picked, setPicked] = useState<ReadonlySet<string>>(
    () => new Set(['alpha', 'bravo', 'charlie']),
  );
  const [locked, setLocked] = useState(false);
  const toggleLock = (next: boolean) => {
    setLocked(next);
    for (const store of [loopStore, batchStore]) {
      store.setLock(asNodeId('charlie'), next ? { move: true } : {});
    }
  };
  const onToggle = (id: NodeId) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(String(id))) next.delete(String(id));
      else next.add(String(id));
      return next;
    });
  };

  return (
    <StrategyRegistryProvider strategies={STRATEGIES}>
      <div className="pol-toolbar">
        <label>
          <input
            type="checkbox"
            checked={locked}
            data-testid="lock-charlie"
            onChange={(e) => toggleLock(e.currentTarget.checked)}
          />{' '}
          Charlie is locked against <code>move</code>
        </label>
      </div>
      <div className="pol-row">
        <Provider store={loopStore}>
          <GeometryProvider>
            <FocusProvider>
              <Board
                label="A loop"
                note="moveNode ×n in one transact"
                batch={false}
                picked={picked}
                onToggle={onToggle}
              />
            </FocusProvider>
          </GeometryProvider>
        </Provider>
        <Provider store={batchStore}>
          <GeometryProvider>
            <FocusProvider>
              <Board
                label="One batch"
                note="moveNodes"
                batch={true}
                picked={picked}
                onToggle={onToggle}
              />
            </FocusProvider>
          </GeometryProvider>
        </Provider>
      </div>
      <div className="pol-prose">
        <p>
          Both boards hold the same tree and the same selection, and both move it to the{' '}
          <em>top</em> of the dock — index 0. The left board loops <code>moveNode</code> inside one{' '}
          <code>transact</code>; the right calls <code>moveNodes</code> once.
        </p>
        <p>
          Press both buttons. The loop inserts each node at 0 in turn, so the run arrives reversed —{' '}
          <code>charlie bravo alpha</code> — while the batch resolves the insertion point once and
          keeps source order. Incrementing the index by hand does not rescue the loop: a pin in the
          destination relocates every insert.
        </p>
        <p>
          Now lock Charlie and press both again. The loop moves Alpha and Bravo, then throws on
          Charlie with those two already relocated — <code>transact</code> brackets events, it does
          not roll back. The batch checks every lock before it mutates anything, so it throws the
          same error and leaves the tree untouched.
        </p>
      </div>
    </StrategyRegistryProvider>
  );
};
