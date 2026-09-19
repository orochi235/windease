import { describe, expect, it } from 'vitest';
import {
  ALL_NUTS_PRESETS,
  GRID_PRESETS,
  OVERLAP_PRESETS,
  PACK_PRESETS,
  type Preset,
  presetToStore,
  STRIP_PRESETS,
  TREE_PRESETS,
} from './index.js';

describe('windease/nuts', () => {
  it('carries every corpus', () => {
    for (const corpus of [
      GRID_PRESETS,
      STRIP_PRESETS,
      OVERLAP_PRESETS,
      PACK_PRESETS,
      TREE_PRESETS,
    ]) {
      expect(corpus.length).toBeGreaterThan(0);
    }
    const sum =
      GRID_PRESETS.length +
      STRIP_PRESETS.length +
      OVERLAP_PRESETS.length +
      PACK_PRESETS.length +
      TREE_PRESETS.length;
    expect(ALL_NUTS_PRESETS.length).toBe(sum);
  });

  it('gives every preset a unique id across the corpora', () => {
    const seen = new Map<string, Preset>();
    for (const preset of ALL_NUTS_PRESETS) {
      expect(seen.has(preset.id), `duplicate preset id ${preset.id}`).toBe(false);
      seen.set(preset.id, preset);
    }
  });

  it('builds a store from every preset the entry point ships', () => {
    for (const preset of ALL_NUTS_PRESETS) {
      expect(() => presetToStore(preset), preset.id).not.toThrow();
    }
  });

  it('describes every preset for a reader who has not seen the product', () => {
    for (const preset of ALL_NUTS_PRESETS) {
      expect(preset.source.length, preset.id).toBeGreaterThan(0);
      expect(preset.stress.length, preset.id).toBeGreaterThan(0);
      expect(preset.description.length, preset.id).toBeGreaterThan(0);
    }
  });
});
