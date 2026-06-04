import {
  asWindowId,
  asZoneId,
  gridStrategy,
  type SerializedStore,
  stackStrategy,
  stripStrategy,
  WindeaseStore,
  type WindowId,
  type ZoneId,
} from '@windease/core';
import type { Story } from '@ladle/react';
import { useEffect, useMemo, useState } from 'react';
import { WindeaseProvider } from '../WindeaseProvider.js';
import { Zone } from '../Zone.js';
import { Panel } from './Panel.js';
import './windease.css';

const MAIN = asZoneId('main');
const SIDEBAR = asZoneId('sidebar');
const DOCK = asZoneId('dock');

const STRATEGIES = {
  grid: gridStrategy,
  stack: stackStrategy,
  strip: stripStrategy,
};

function makeStore(): WindeaseStore {
  const s = new WindeaseStore();
  s.registerZone({ id: MAIN, strategy: gridStrategy, config: { cols: 2, gap: 8, padding: 8 } });
  s.registerZone({ id: SIDEBAR, strategy: stackStrategy, config: { gap: 6, padding: 6 } });
  s.registerZone({
    id: DOCK,
    strategy: stripStrategy,
    config: { axis: 'x', gap: 6, padding: 6 },
  });

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
  // Mutable counters for fresh ids.
  const counters = useMemo(() => ({ panel: 2, widget: 1, tool: 1 }), []);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const offs = [
      store.events.on('window.created', bump),
      store.events.on('window.destroyed', bump),
      store.events.on('window.transitioned', bump),
      store.events.on('zone.claimed', bump),
      store.events.on('zone.released', bump),
      store.events.on('zone.reordered', bump),
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
    store.destroy(id);
    setSelected(null);
  });
  const moveTo = (zone: ZoneId) => withSelected((id) => store.moveWindow(id, zone));

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

  const renderPanel = (w: Parameters<Parameters<typeof Zone>[0]['children']>[0]) => (
    <Panel
      window={w}
      selected={selected === w.id}
      onSelect={(id) => setSelected(id as WindowId)}
    />
  );

  return (
    <WindeaseProvider store={store}>
      <div>
        <div className="story-toolbar">
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
          <button type="button" onClick={destroy} disabled={!selected}>
            Destroy selected
          </button>
          <button type="button" onClick={moveTo(MAIN)} disabled={!selected}>
            → main
          </button>
          <button type="button" onClick={moveTo(SIDEBAR)} disabled={!selected}>
            → sidebar
          </button>
          <button type="button" onClick={moveTo(DOCK)} disabled={!selected}>
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

        <div className="story-playground">
          <div className="story-playground__main">
            <div className="story-zone-label">main (grid)</div>
            <div style={{ width: '100%', height: 360 }}>
              <Zone id={MAIN}>{renderPanel}</Zone>
            </div>
          </div>

          <div className="story-playground__sidebar">
            <div className="story-zone-label">sidebar (stack)</div>
            <div style={{ width: '100%', height: 540 }}>
              <Zone id={SIDEBAR}>{renderPanel}</Zone>
            </div>
          </div>

          <div className="story-playground__dock">
            <div className="story-zone-label">dock (strip-x)</div>
            <div style={{ width: '100%', height: 120 }}>
              <Zone id={DOCK}>{renderPanel}</Zone>
            </div>
          </div>
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
