import type { WindeaseStore, ZoneId } from '@windease/core';
import type * as React from 'react';

interface GridControlsProps {
  store: WindeaseStore;
  zoneId: ZoneId;
  onChange: () => void;
}

interface GridConfig {
  cols?: number;
  rows?: number;
  maxCols?: number;
  maxRows?: number;
  [k: string]: unknown;
}

const FIELDS = ['cols', 'rows', 'maxCols', 'maxRows'] as const;

export function GridControls({ store, zoneId, onChange }: GridControlsProps): React.JSX.Element {
  const zone = store.getZone(zoneId);
  const cfg = (zone?.config ?? {}) as GridConfig;

  const update = (key: (typeof FIELDS)[number], raw: string) => {
    const z = store.getZone(zoneId);
    if (!z) return;
    const c = z.config as GridConfig;
    if (raw === '') {
      delete c[key];
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 1) return;
      c[key] = Math.floor(n);
    }
    onChange();
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
    </div>
  );
}
