import { columnStrategy, shelfStrategy, skylineStrategy } from '#windease/index.js';
import type { Packer } from './types.js';

export const PACKERS: readonly Packer[] = [shelfStrategy, columnStrategy, skylineStrategy].map(
  (strategy) => ({ id: strategy.name, strategy }),
);

export function packerById(id: string): Packer {
  const packer = PACKERS.find((p) => p.id === id);
  if (!packer) throw new Error(`pack lab: no packer "${id}"`);
  return packer;
}

export const optionKeys = (packer: Packer): string[] =>
  Object.keys(packer.strategy.configSpec ?? {});
