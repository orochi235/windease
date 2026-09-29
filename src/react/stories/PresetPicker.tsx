import { useCallback, useEffect, useState } from 'react';
import type { Preset } from '../../nuts/preset.js';

/**
 * The chosen preset, starting at `initialId` (a story arg, so a URL can pick
 * one) and following it when the arg changes; the on-page picker sets it too.
 *
 * `run.key` changes with the pick and with every `run.reset()`. A story keys
 * the view that builds the preset's store on it, so Reset rebuilds the store.
 */
export function usePresetPick(presets: readonly Preset[], initialId?: string) {
  const [id, setId] = useState(initialId ?? presets[0]!.id);
  const [runs, setRuns] = useState(0);
  useEffect(() => {
    if (initialId !== undefined) setId(initialId);
  }, [initialId]);
  const reset = useCallback(() => setRuns((n) => n + 1), []);
  const preset = presets.find((p) => p.id === id) ?? presets[0]!;
  return [preset, setId, { key: `${preset.id}:${runs}`, reset }] as const;
}

/** The on-page preset dropdown every Exotic story shares, labeled by product. */
export function PresetPicker({
  presets,
  value,
  onChange,
  onReset,
  testId = 'preset-picker',
}: {
  presets: readonly Preset[];
  value: Preset;
  onChange: (id: string) => void;
  /** Puts the preset back as it opened. Omit where nothing can be changed. */
  onReset?: () => void;
  testId?: string;
}) {
  return (
    <div className="preset-picker">
      {onReset ? (
        <button type="button" data-testid="preset-reset" onClick={onReset}>
          Reset
        </button>
      ) : null}
      <label>
        Preset{' '}
        <select data-testid={testId} value={value.id} onChange={(e) => onChange(e.target.value)}>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.source}
            </option>
          ))}
        </select>
      </label>
      <span className="preset-picker__count">
        {presets.indexOf(value) + 1} of {presets.length}
      </span>
    </div>
  );
}
