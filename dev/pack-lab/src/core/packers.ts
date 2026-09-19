import { columnStrategy, shelfStrategy, skylineStrategy } from '#windease/index.js';
import { engineStrategy } from './engine/engine.js';
import { RECIPES } from './engine/recipes.js';
import type { Packer } from './types.js';

/** The shipped packers, on in a new trial, then every engine recipe, off. */
export const PACKERS: readonly Packer[] = [
  ...[shelfStrategy, columnStrategy, skylineStrategy].map((strategy) => ({
    id: strategy.name,
    strategy,
    on: true,
  })),
  ...RECIPES.map((recipe) => {
    const strategy = engineStrategy(recipe);
    return { id: strategy.name, strategy, recipe, on: false };
  }),
];

export function packerById(id: string): Packer {
  const packer = PACKERS.find((p) => p.id === id);
  if (!packer) throw new Error(`pack lab: no packer "${id}"`);
  return packer;
}

export const optionKeys = (packer: Packer): string[] =>
  Object.keys(packer.strategy.configSpec ?? {});

/** Whether `packer` takes `value` for option `key`: any value of a key it declares, or for an
 *  enumerated key, one of the values listed. */
export function acceptsOption(packer: Packer, key: string, value: unknown): boolean {
  const spec = packer.strategy.configSpec?.[key];
  if (spec === undefined) return false;
  return Array.isArray(spec) ? spec.includes(value as string) : true;
}
