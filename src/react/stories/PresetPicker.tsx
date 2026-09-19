import { useEffect, useState } from 'react';
import type { Preset } from '../../nuts/preset.js';

/**
 * The chosen preset, starting at `initialId` (a story arg, so a URL can pick
 * one) and following it when the arg changes; the on-page picker sets it too.
 */
export function usePresetPick(presets: readonly Preset[], initialId?: string) {
  const [id, setId] = useState(initialId ?? presets[0]!.id);
  useEffect(() => {
    if (initialId !== undefined) setId(initialId);
  }, [initialId]);
  const preset = presets.find((p) => p.id === id) ?? presets[0]!;
  return [preset, setId] as const;
}

/** The on-page preset dropdown every Exotic story shares, labeled by product. */
export function PresetPicker({
  presets,
  value,
  onChange,
  testId = 'preset-picker',
}: {
  presets: readonly Preset[];
  value: Preset;
  onChange: (id: string) => void;
  testId?: string;
}) {
  return (
    <label className="preset-picker">
      Preset{' '}
      <select data-testid={testId} value={value.id} onChange={(e) => onChange(e.target.value)}>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.source}
          </option>
        ))}
      </select>{' '}
      <span className="preset-picker__count">
        {presets.indexOf(value) + 1} of {presets.length}
      </span>
    </label>
  );
}
