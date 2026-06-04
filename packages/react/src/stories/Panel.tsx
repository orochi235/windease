import type { WindowRecord } from '@windease/core';
import type * as React from 'react';

const COLOR_CLASSES = [
  'story-panel--red',
  'story-panel--green',
  'story-panel--blue',
  'story-panel--amber',
  'story-panel--purple',
  'story-panel--pink',
  'story-panel--teal',
] as const;

export function colorClassForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLOR_CLASSES[hash % COLOR_CLASSES.length] as string;
}

interface PanelProps {
  window: WindowRecord;
  label?: string;
  selected?: boolean;
  pinned?: boolean;
  locked?: boolean;
  onSelect?: (id: string) => void;
  onClose?: (id: string) => void;
}

export function Panel({
  window: w,
  label,
  selected,
  pinned,
  locked,
  onSelect,
  onClose,
}: PanelProps): React.JSX.Element {
  const cls = ['story-panel', colorClassForId(w.id)];
  if (selected) cls.push('is-selected');
  if (pinned) cls.push('is-pinned');
  if (locked) cls.push('is-locked');
  return (
    <div
      role="button"
      tabIndex={0}
      className={cls.join(' ')}
      onClick={() => onSelect?.(w.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.(w.id);
        }
      }}
      data-testid={`panel-${w.id}`}
      data-pinned={pinned ? 'true' : undefined}
      data-locked={locked ? 'true' : undefined}
    >
      {locked ? (
        <span className="story-panel__lock" aria-hidden="true">🔒</span>
      ) : pinned ? (
        <span className="story-panel__pin" aria-hidden="true">📌</span>
      ) : null}
      {!locked && onClose && (
        <button
          type="button"
          className="story-panel__close"
          aria-label={`Close ${label ?? w.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose(w.id);
          }}
          data-testid={`panel-close-${w.id}`}
        >
          ×
        </button>
      )}
      <span className="story-panel__title">{label ?? w.id}</span>
      <span className="story-panel__meta">kind: {w.kind}</span>
      <span className="story-panel__meta">lifecycle: {w.lifecycle.state}</span>
      <span className="story-panel__meta">transit: {w.transit.state}</span>
      <span className="story-panel__meta">zone: {w.zoneId ?? '<none>'}</span>
    </div>
  );
}
