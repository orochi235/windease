import type { WindeaseStore, ZoneId } from '@windease/core';
import type * as React from 'react';

interface GridControlsProps {
  store: WindeaseStore;
  zoneId: ZoneId;
}

interface GridConfig {
  cols?: number;
  rows?: number;
  maxCols?: number;
  maxRows?: number;
  fill?: boolean;
  [k: string]: unknown;
}

const FIELDS = ['cols', 'rows', 'maxCols', 'maxRows'] as const;

export function GridControls({ store, zoneId }: GridControlsProps): React.JSX.Element {
  const zone = store.getZone(zoneId);
  const cfg = (zone?.config ?? {}) as GridConfig;
  const allowsPinning = zone?.allowsPinning !== false;
  const fill = cfg.fill !== false;

  const update = (key: (typeof FIELDS)[number], raw: string) => {
    if (raw === '') {
      store.updateZoneConfig(zoneId, { [key]: undefined });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return;
    store.updateZoneConfig(zoneId, { [key]: Math.floor(n) });
  };

  return (
    <div
      className="story-grid-controls"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="story-grid-controls__title">{zoneId} grid</span>
      {FIELDS.map((key) => (
        <label key={key} className="story-grid-controls__field">
          <span className="story-grid-controls__label">{key}</span>
          <input
            type="number"
            min={1}
            className="story-grid-controls__input"
            value={cfg[key] ?? ''}
            placeholder="auto"
            onChange={(e) => update(key, e.target.value)}
          />
        </label>
      ))}
      <label className="story-grid-controls__check">
        <input
          type="checkbox"
          checked={allowsPinning}
          onChange={(e) => store.setZoneAllowsPinning(zoneId, e.target.checked)}
        />
        <span>allow pinning</span>
      </label>
      <label className="story-grid-controls__check">
        <input
          type="checkbox"
          checked={fill}
          onChange={(e) =>
            store.updateZoneConfig(zoneId, { fill: e.target.checked ? undefined : false })
          }
        />
        <span>expand to fill</span>
      </label>
    </div>
  );
}
