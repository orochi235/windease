import type { ReactNode } from 'react';
import type { Preset } from '../../nuts/preset.js';
import './preset-info.css';

/**
 * A preset's header for the Exotic stories: what the real layout is and what it
 * stresses. `children` adds a live line (a packer's fill, say) beneath. The
 * derived properties sit below the example, in {@link PresetCode}'s tabs, so
 * this header stays short and the example keeps its place on the page.
 */
export function PresetInfo({ preset, children }: { preset: Preset; children?: ReactNode }) {
  return (
    <section className="preset-info" aria-label="Preset">
      <h2 className="preset-info__source" data-testid="preset-source">
        {preset.source}
      </h2>
      <p className="preset-info__description">{preset.description}</p>
      <p className="preset-info__stress">
        <strong>Stresses:</strong> {preset.stress}
      </p>
      {children}
    </section>
  );
}
