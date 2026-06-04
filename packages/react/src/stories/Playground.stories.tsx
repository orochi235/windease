import {
  asWindowId,
  asZoneId,
  gridStrategy,
  HistoryController,
  recursiveSplit,
  type SerializedStore,
  type SplitNode,
  stackStrategy,
  stripStrategy,
  WindeaseStore,
  type WindowId,
  type ZoneId,
} from '@windease/core';
import type { Story } from '@ladle/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type HistoryHookup, WindeaseProvider } from '../WindeaseProvider.js';
import { Workspace } from '../Workspace.js';
import { Zone } from '../Zone.js';
import { GridControls } from './GridControls.js';
import { Panel } from './Panel.js';
import './windease.css';

const GRID_CONTROLS_ID = asWindowId('grid-controls');

const MAIN = asZoneId('main');
const SIDEBAR = asZoneId('sidebar');
const DOCK = asZoneId('dock');

const STRATEGIES = {
  grid: gridStrategy,
  stack: stackStrategy,
  strip: stripStrategy,
};

const INITIAL_WORKSPACE_TREE: SplitNode = {
  kind: 'split',
  direction: 'horizontal',
  ratio: 0.75,
  a: {
    kind: 'split',
    direction: 'vertical',
    ratio: 0.82,
    a: { kind: 'leaf', id: MAIN },
    b: { kind: 'leaf', id: DOCK },
  },
  b: { kind: 'leaf', id: SIDEBAR },
};

interface PlaygroundSnapshot {
  store: SerializedStore;
  workspace: SplitNode;
}

function makeStore(): WindeaseStore {
  const s = new WindeaseStore();
  s.registerZone({
    id: MAIN,
    strategy: gridStrategy,
    config: { gap: 8, padding: 8, maxCols: 2, maxRows: 2 },
  });
  s.registerZone({ id: SIDEBAR, strategy: stackStrategy, config: { gap: 6, padding: 6 } });
  s.registerZone({
    id: DOCK,
    strategy: stripStrategy,
    config: { axis: 'x', gap: 6, padding: 6, fill: true },
  });

  // Seed the grid-controls widget in the main zone, pinned + locked so it
  // sits at the top of the grid and can't be dragged or destroyed.
  s.createWindow({ id: GRID_CONTROLS_ID, kind: 'widget' });
  s.show(GRID_CONTROLS_ID);
  s.claim(MAIN, GRID_CONTROLS_ID, undefined, { pinned: true, locked: true });
  // Seed two main-area panels.
  for (let i = 0; i < 2; i++) {
    const id = asWindowId(`panel-${i + 1}`);
    s.createWindow({ id, kind: 'panel' });
    s.show(id);
    s.claim(MAIN, id);
  }
  // One sidebar widget.
  const w1 = asWindowId('widget-1');
  s.createWindow({ id: w1, kind: 'widget', hints: { preferredSize: { w: 0, h: 120 } } });
  s.show(w1);
  s.claim(SIDEBAR, w1);
  // One dock tool.
  const t1 = asWindowId('tool-1');
  s.createWindow({ id: t1, kind: 'tool', hints: { preferredSize: { w: 100, h: 0 } } });
  s.show(t1);
  s.claim(DOCK, t1);

  return s;
}

export const Playground: Story = () => {
  const store = useMemo(() => makeStore(), []);
  const [selected, setSelected] = useState<WindowId | null>(null);
  const [, setTick] = useState(0);
  const [snapshotText, setSnapshotText] = useState<string>('');
  const [workspaceState, setWorkspaceState] = useState<SplitNode>(INITIAL_WORKSPACE_TREE);
  // Mutable counters for fresh ids.
  const counters = useMemo(() => ({ panel: 2, widget: 1, tool: 1 }), []);

  const workspaceStateRef = useRef<SplitNode>(workspaceState);
  useEffect(() => {
    workspaceStateRef.current = workspaceState;
  }, [workspaceState]);

  const controller = useMemo(() => new HistoryController<PlaygroundSnapshot>(), []);

  const capture = useCallback(
    (): PlaygroundSnapshot => ({
      store: store.snapshot(),
      workspace: workspaceStateRef.current,
    }),
    [store],
  );

  const restore = useCallback(
    (snap: PlaygroundSnapshot) => {
      store.hydrate(snap.store, { strategies: STRATEGIES });
      setWorkspaceState(snap.workspace);
    },
    [store],
  );

  const historyHookup = useMemo(
    () => ({ controller, capture, restore }) as unknown as HistoryHookup<unknown>,
    [controller, capture, restore],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const snap = controller.undo();
        if (snap) restore(snap);
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault();
        const snap = controller.redo();
        if (snap) restore(snap);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [controller, restore]);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const offs = [
      store.events.on('window.created', bump),
      store.events.on('window.destroyed', bump),
      store.events.on('window.transitioned', bump),
      store.events.on('zone.claimed', bump),
      store.events.on('zone.released', bump),
      store.events.on('zone.reordered', bump),
      store.events.on('zone.metaChanged', bump),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [store]);

  const addTo = (zone: ZoneId, kind: 'panel' | 'widget' | 'tool') => {
    counters[kind] += 1;
    const idStr =
      kind === 'panel'
        ? `panel-${counters.panel}`
        : kind === 'widget'
          ? `widget-${counters.widget}`
          : `tool-${counters.tool}`;
    const id = asWindowId(idStr);
    const hints =
      kind === 'widget'
        ? { preferredSize: { w: 0, h: 100 } }
        : kind === 'tool'
          ? { preferredSize: { w: 100, h: 0 } }
          : undefined;
    store.createWindow({ id, kind, hints });
    store.show(id);
    store.claim(zone, id);
    setSelected(id);
  };

  const withSelected = (fn: (id: WindowId) => void) => () => {
    if (!selected) return;
    try {
      fn(selected);
    } catch (err) {
      console.warn('[playground] action failed:', err);
    }
  };

  const hide = withSelected((id) => store.hide(id));
  const show = withSelected((id) => store.show(id));
  const destroy = withSelected((id) => {
    const w = store.getWindow(id);
    if (w?.zoneId && store.getItemMeta(w.zoneId, id)?.locked) return;
    store.destroy(id);
    setSelected(null);
  });
  const moveTo = (zone: ZoneId) =>
    withSelected((id) => {
      const w = store.getWindow(id);
      if (w?.zoneId && store.getItemMeta(w.zoneId, id)?.locked) return;
      store.moveWindow(id, zone);
    });

  const doSnapshot = () => {
    const snap = store.snapshot();
    const text = JSON.stringify(snap, null, 2);
    setSnapshotText(text);
    console.log('[playground] snapshot:', snap);
  };

  const doHydrate = () => {
    if (!snapshotText) {
      console.warn('[playground] no snapshot to hydrate from');
      return;
    }
    const snap = JSON.parse(snapshotText) as SerializedStore;
    store.hydrate(snap, { strategies: STRATEGIES });
    setSelected(null);
  };

  const renderPanel = (w: Parameters<Parameters<typeof Zone>[0]['children']>[0]) => {
    if (w.id === GRID_CONTROLS_ID) {
      return <GridControls store={store} zoneId={MAIN} onChange={() => setTick((n) => n + 1)} />;
    }
    const zoneId = w.zoneId;
    const meta = zoneId ? store.getItemMeta(zoneId, w.id) : undefined;
    const pinned = Boolean(meta?.pinned);
    const locked = Boolean(meta?.locked);
    return (
      <Panel
        window={w}
        selected={selected === w.id}
        pinned={pinned}
        locked={locked}
        onSelect={(id) => setSelected(id as WindowId)}
        onClose={(id) => {
          store.destroy(id as WindowId);
          if (selected === id) setSelected(null);
        }}
      />
    );
  };

  const isSelectedLocked = (): boolean => {
    if (!selected) return false;
    const w = store.getWindow(selected);
    if (!w?.zoneId) return false;
    return Boolean(store.getItemMeta(w.zoneId, selected)?.locked);
  };

  const togglePin = withSelected((id) => {
    const w = store.getWindow(id);
    if (!w?.zoneId) return;
    if (store.getItemMeta(w.zoneId, id)?.locked) return;
    const current = Boolean(store.getItemMeta(w.zoneId, id)?.pinned);
    store.patchItemMeta(w.zoneId, id, { pinned: current ? undefined : true });
  });

  return (
    <WindeaseProvider store={store} history={historyHookup}>
      <div>
        <div className="story-toolbar">
          <button
            type="button"
            onClick={() => {
              const s = controller.undo();
              if (s) restore(s);
            }}
            disabled={!controller.canUndo()}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => {
              const s = controller.redo();
              if (s) restore(s);
            }}
            disabled={!controller.canRedo()}
          >
            Redo
          </button>
          <button type="button" onClick={() => addTo(MAIN, 'panel')}>
            Add panel
          </button>
          <button type="button" onClick={() => addTo(SIDEBAR, 'widget')}>
            Add widget to sidebar
          </button>
          <button type="button" onClick={() => addTo(DOCK, 'tool')}>
            Add tool to dock
          </button>
          <button type="button" onClick={hide} disabled={!selected}>
            Hide selected
          </button>
          <button type="button" onClick={show} disabled={!selected}>
            Show selected
          </button>
          <button type="button" onClick={destroy} disabled={!selected || isSelectedLocked()}>
            Destroy selected
          </button>
          <button type="button" onClick={togglePin} disabled={!selected || isSelectedLocked()}>
            Toggle pin
          </button>
          <button type="button" onClick={moveTo(MAIN)} disabled={!selected || isSelectedLocked()}>
            → main
          </button>
          <button type="button" onClick={moveTo(SIDEBAR)} disabled={!selected || isSelectedLocked()}>
            → sidebar
          </button>
          <button type="button" onClick={moveTo(DOCK)} disabled={!selected || isSelectedLocked()}>
            → dock
          </button>
          <button type="button" onClick={doSnapshot}>
            Snapshot
          </button>
          <button type="button" onClick={doHydrate} disabled={!snapshotText}>
            Hydrate from snapshot
          </button>
          <span className="story-toolbar__selected">selected: {selected ?? '<none>'}</span>
        </div>

        <div style={{ width: '100%', height: 600 }}>
          <Workspace
            strategy={recursiveSplit}
            items={[{ id: MAIN }, { id: DOCK }, { id: SIDEBAR }]}
            state={workspaceState}
            onStateChange={setWorkspaceState}
          >
            {(item) => <Zone id={item.id as typeof MAIN}>{renderPanel}</Zone>}
          </Workspace>
        </div>

        {snapshotText && (
          <>
            <div className="story-zone-label">snapshot</div>
            <pre className="story-snapshot">{snapshotText}</pre>
          </>
        )}
      </div>
    </WindeaseProvider>
  );
};
