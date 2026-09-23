/**
 * Vector art for the duel board story: a small vocabulary of SVG motifs and a
 * lookup from a card's name to the one it should wear.
 *
 * Every motif is drawn in a 100 x 100 user-space box with `y = 100` as the
 * ground line, so a motif sits on the ground rather than floating in its box.
 * Paths are closed shapes in absolute `M L H V C Q Z` only, which lets a
 * consumer fill them, stroke them, or both.
 */

export interface Motif {
  /** Silhouette paths, drawn in the scene's ink color. */
  ink: string[];
  /** Detail drawn over the silhouette in the accent color. Optional. */
  cut?: string[];
}

export const MOTIFS: Record<string, Motif> = {
  ladder: {
    ink: [
      'M 14 100 L 26 100 L 48 22 L 42 22 Z',
      'M 86 100 L 74 100 L 52 22 L 58 22 Z',
      'M 30 84 L 70 84 L 70 90 L 30 90 Z',
      'M 36 62 L 64 62 L 64 68 L 36 68 Z',
      'M 41 40 L 59 40 L 59 46 L 41 46 Z',
    ],
  },

  rack: {
    ink: [
      'M 12 84 L 88 84 L 88 96 L 12 96 Z',
      'M 20 46 L 26 46 L 26 84 L 20 84 Z M 34 46 L 40 46 L 40 84 L 34 84 Z M 48 46 L 54 46 L 54 84 L 48 84 Z M 62 46 L 68 46 L 68 84 L 62 84 Z M 76 46 L 82 46 L 82 84 L 76 84 Z',
    ],
    cut: [
      'M 28 34 L 36 34 L 36 82 L 28 82 Z M 52 34 L 60 34 L 60 82 L 52 82 Z M 66 40 L 74 40 L 74 82 L 66 82 Z',
    ],
  },

  board: {
    ink: [
      'M 10 46 Q 10 40 18 40 L 82 40 Q 90 40 90 46 Q 90 52 82 52 L 18 52 Q 10 52 10 46 Z',
      'M 24 52 L 32 52 L 46 100 L 38 100 Z M 76 52 L 68 52 L 54 100 L 62 100 Z',
    ],
    cut: ['M 22 43 L 78 43 L 78 47 L 22 47 Z'],
  },

  colander: {
    ink: [
      'M 16 46 L 84 46 Q 84 92 50 92 Q 16 92 16 46 Z',
      'M 6 46 L 16 46 L 16 54 L 6 54 Z M 84 46 L 94 46 L 94 54 L 84 54 Z',
      'M 38 92 L 62 92 L 62 98 L 38 98 Z',
    ],
    cut: [
      'M 30 58 L 34 62 L 30 66 L 26 62 Z M 48 58 L 52 62 L 48 66 L 44 62 Z M 66 58 L 70 62 L 66 66 L 62 62 Z M 39 72 L 43 76 L 39 80 L 35 76 Z M 57 72 L 61 76 L 57 80 L 53 76 Z',
    ],
  },

  box: {
    ink: ['M 14 46 L 86 46 L 86 96 L 14 96 Z', 'M 10 34 L 90 34 L 90 48 L 10 48 Z'],
    cut: ['M 44 48 L 56 48 L 56 60 L 44 60 Z', 'M 24 68 L 76 68 L 76 74 L 24 74 Z'],
  },

  hook: {
    ink: [
      'M 36 12 L 64 12 L 64 30 L 36 30 Z',
      'M 46 30 L 54 30 L 54 62 Q 54 80 38 80 Q 26 80 26 66 L 34 66 Q 34 72 39 72 Q 46 72 46 62 Z',
    ],
    cut: ['M 42 17 L 48 17 L 48 24 L 42 24 Z M 53 17 L 59 17 L 59 24 L 53 24 Z'],
  },

  brush: {
    ink: [
      'M 18 56 Q 50 44 82 56 L 82 70 L 18 70 Z',
      'M 22 70 L 26 70 L 26 92 L 22 92 Z M 32 70 L 36 70 L 36 94 L 32 94 Z M 42 70 L 46 70 L 46 96 L 42 96 Z M 54 70 L 58 70 L 58 96 L 54 96 Z M 64 70 L 68 70 L 68 94 L 64 94 Z M 74 70 L 78 70 L 78 92 L 74 92 Z',
    ],
  },

  wedge: {
    ink: ['M 8 100 L 92 100 L 92 66 Z'],
    cut: ['M 66 86 L 86 86 L 86 94 L 66 94 Z', 'M 40 94 L 60 94 L 60 98 L 40 98 Z'],
  },

  cord: {
    ink: [
      'M 50 34 Q 86 34 86 64 Q 86 94 50 94 Q 14 94 14 64 Q 14 34 50 34 Z M 50 46 Q 26 46 26 64 Q 26 82 50 82 Q 74 82 74 64 Q 74 46 50 46 Z',
      'M 68 12 L 88 12 L 88 30 L 68 30 Z',
      'M 88 15 L 98 15 L 98 19 L 88 19 Z M 88 23 L 98 23 L 98 27 L 88 27 Z',
    ],
  },

  cloth: {
    ink: ['M 18 14 L 82 14 L 82 82 Q 66 92 50 82 Q 34 72 18 82 Z'],
    cut: ['M 18 26 L 82 26 L 82 32 L 18 32 Z M 18 38 L 82 38 L 82 44 L 18 44 Z'],
  },

  drawer: {
    ink: ['M 10 42 L 90 42 L 90 96 L 10 96 Z', 'M 40 62 L 60 62 L 60 74 L 40 74 Z'],
    cut: ['M 20 50 L 80 50 L 80 56 L 20 56 Z', 'M 20 82 L 80 82 L 80 88 L 20 88 Z'],
  },

  sack: {
    ink: [
      'M 50 18 L 34 30 Q 12 62 26 84 Q 38 98 50 98 Q 62 98 74 84 Q 88 62 66 30 Z',
      'M 38 12 L 62 12 L 58 26 L 42 26 Z',
    ],
    cut: ['M 38 52 Q 50 62 62 52 L 62 60 Q 50 70 38 60 Z'],
  },

  dish: {
    ink: [
      'M 14 56 L 86 56 L 78 92 L 22 92 Z',
      'M 10 46 L 90 46 L 90 56 L 10 56 Z M 44 36 L 56 36 L 56 46 L 44 46 Z',
      'M 4 60 L 14 60 L 14 70 L 4 70 Z M 86 60 L 96 60 L 96 70 L 86 70 Z',
    ],
    cut: ['M 24 68 L 76 68 L 76 74 L 24 74 Z'],
  },

  eggcup: {
    ink: [
      'M 50 22 Q 66 34 66 46 Q 66 58 50 58 Q 34 58 34 46 Q 34 34 50 22 Z',
      'M 34 54 L 66 54 L 62 80 L 38 80 Z',
      'M 42 80 L 58 80 L 58 90 L 66 90 L 66 96 L 34 96 L 34 90 L 42 90 Z',
    ],
    cut: ['M 37 60 L 63 60 L 62 66 L 38 66 Z'],
  },

  level: {
    ink: ['M 6 44 L 94 44 L 94 62 L 6 62 Z'],
    cut: [
      'M 36 48 L 64 48 L 64 58 L 36 58 Z',
      'M 14 50 L 24 50 L 24 56 L 14 56 Z M 76 50 L 86 50 L 86 56 L 76 56 Z',
    ],
  },

  bucket: {
    ink: [
      'M 20 40 L 80 40 L 72 96 L 28 96 Z',
      'M 14 30 L 86 30 L 86 40 L 14 40 Z M 44 22 L 56 22 L 56 30 L 44 30 Z',
    ],
    cut: ['M 24 56 L 76 56 L 76 62 L 24 62 Z M 26 72 L 74 72 L 74 78 L 26 78 Z'],
  },

  ring: {
    ink: [
      'M 50 26 Q 88 26 88 62 Q 88 98 50 98 Q 12 98 12 62 Q 12 26 50 26 Z M 50 44 Q 30 44 30 62 Q 30 80 50 80 Q 70 80 70 62 Q 70 44 50 44 Z',
    ],
    cut: ['M 22 56 L 32 56 L 32 68 L 22 68 Z M 68 56 L 78 56 L 78 68 L 68 68 Z'],
  },

  lampshade: {
    ink: [
      'M 30 24 L 70 24 L 84 62 L 16 62 Z',
      'M 46 62 L 54 62 L 54 90 L 46 90 Z',
      'M 28 90 L 72 90 L 72 98 L 28 98 Z',
    ],
    cut: ['M 20 54 L 80 54 L 80 60 L 20 60 Z'],
  },

  bottle: {
    ink: ['M 42 10 L 58 10 L 58 24 Q 82 34 82 62 Q 82 94 50 94 Q 18 94 18 62 Q 18 34 42 24 Z'],
    cut: ['M 28 56 L 72 56 L 72 62 L 28 62 Z M 28 70 L 72 70 L 72 76 L 28 76 Z'],
  },

  key: {
    ink: [
      'M 50 6 Q 70 6 70 22 Q 70 38 50 38 Q 30 38 30 22 Q 30 6 50 6 Z M 50 16 Q 42 16 42 22 Q 42 28 50 28 Q 58 28 58 22 Q 58 16 50 16 Z',
      'M 46 34 L 54 34 L 54 92 L 46 92 Z',
      'M 54 66 L 68 66 L 68 74 L 54 74 Z M 54 82 L 64 82 L 64 90 L 54 90 Z',
    ],
  },

  pin: {
    ink: [
      'M 26 44 L 74 44 L 74 68 L 26 68 Z',
      'M 6 50 L 26 50 L 26 62 L 6 62 Z M 74 50 L 94 50 L 94 62 L 74 62 Z',
    ],
    cut: ['M 32 50 L 68 50 L 68 54 L 32 54 Z'],
  },

  fan: {
    ink: [
      'M 10 22 L 90 22 L 90 96 L 10 96 Z M 20 32 L 20 86 L 80 86 L 80 32 Z',
      'M 50 36 Q 76 42 72 62 L 50 60 Z M 70 72 Q 58 90 38 80 L 50 62 Z M 30 78 Q 14 60 28 44 L 48 58 Z',
      'M 50 50 Q 60 50 60 59 Q 60 68 50 68 Q 40 68 40 59 Q 40 50 50 50 Z',
    ],
  },

  door: {
    ink: ['M 18 12 L 82 12 L 82 100 L 18 100 Z'],
    cut: [
      'M 28 22 L 72 22 L 72 48 L 28 48 Z M 28 62 L 72 62 L 72 88 L 28 88 Z',
      'M 68 51 L 78 51 L 78 59 L 68 59 Z',
    ],
  },

  whacker: {
    ink: [
      'M 24 14 L 34 14 L 74 84 L 64 84 Z',
      'M 56 78 Q 84 74 88 92 Q 66 100 56 92 Z',
      'M 14 10 L 40 10 L 40 18 L 14 18 Z',
    ],
    cut: ['M 84 86 L 96 92 L 94 98 L 82 92 Z'],
  },

  barrow: {
    ink: [
      'M 10 38 L 74 38 L 62 70 L 22 70 Z',
      'M 74 38 L 92 46 L 90 54 L 72 46 Z',
      'M 58 64 L 68 64 L 68 92 L 58 92 Z',
      'M 26 72 Q 40 72 40 86 Q 40 100 26 100 Q 12 100 12 86 Q 12 72 26 72 Z',
    ],
    cut: ['M 26 82 L 30 86 L 26 90 L 22 86 Z'],
  },

  wyrm: {
    ink: [
      'M 62 8 Q 84 8 84 26 Q 84 44 62 44 Q 40 44 40 26 Q 40 8 62 8 Z',
      'M 40 26 Q 14 30 14 54 Q 14 78 44 78 Q 62 78 62 88 Q 62 96 52 96 Q 44 96 44 90 L 30 90 Q 30 100 52 100 Q 76 100 76 86 Q 76 68 44 66 Q 26 66 26 54 Q 26 40 44 38 Z',
      'M 84 22 L 98 18 L 98 22 L 88 25 L 98 28 L 98 32 L 84 28 Z',
    ],
    cut: ['M 64 18 L 74 18 L 74 28 L 64 28 Z'],
  },

  drake: {
    ink: [
      'M 34 62 Q 58 54 70 66 Q 76 76 62 82 Q 40 88 32 78 Z',
      'M 60 68 Q 74 52 70 36 L 84 32 Q 90 52 76 70 Z M 62 22 L 90 22 L 96 34 L 64 36 Z',
      'M 44 60 L 20 22 L 58 36 L 78 20 L 74 56 Z',
      'M 40 82 L 48 82 L 48 98 L 40 98 Z M 58 80 L 66 80 L 66 98 L 58 98 Z',
      'M 32 72 L 8 88 L 4 80 L 30 62 Z',
    ],
  },

  revenant: {
    ink: [
      'M 50 8 Q 70 8 70 30 Q 70 46 50 46 Q 30 46 30 30 Q 30 8 50 8 Z',
      'M 34 40 L 66 40 L 80 100 L 20 100 Z',
      'M 34 50 L 16 76 L 24 82 L 42 58 Z M 66 50 L 84 76 L 76 82 L 58 58 Z',
    ],
    cut: [
      'M 39 22 L 47 22 L 47 32 L 39 32 Z M 53 22 L 61 22 L 61 32 L 53 32 Z',
      'M 40 58 L 60 58 L 60 62 L 40 62 Z M 38 68 L 62 68 L 62 72 L 38 72 Z',
    ],
  },

  scroll: {
    ink: [
      'M 22 22 L 78 22 L 78 78 L 22 78 Z',
      'M 12 12 L 88 12 L 88 26 L 12 26 Z',
      'M 12 74 L 88 74 L 88 88 L 12 88 Z',
    ],
    cut: [
      'M 32 36 L 68 36 L 68 41 L 32 41 Z M 32 48 L 60 48 L 60 53 L 32 53 Z M 32 60 L 68 60 L 68 65 L 32 65 Z',
    ],
  },

  sigil: {
    ink: [
      'M 50 6 Q 94 6 94 50 Q 94 94 50 94 Q 6 94 6 50 Q 6 6 50 6 Z M 50 18 Q 18 18 18 50 Q 18 82 50 82 Q 82 82 82 50 Q 82 18 50 18 Z',
    ],
    cut: ['M 50 24 L 60 44 L 50 76 L 40 44 Z', 'M 26 50 L 50 42 L 74 50 L 50 58 Z'],
  },

  reliquary: {
    ink: [
      'M 18 48 L 82 48 L 82 86 L 18 86 Z',
      'M 18 48 L 50 26 L 82 48 Z',
      'M 20 86 L 32 86 L 32 96 L 20 96 Z M 68 86 L 80 86 L 80 96 L 68 96 Z',
    ],
    cut: ['M 50 56 L 62 68 L 50 80 L 38 68 Z', 'M 46 30 L 54 30 L 54 48 L 46 48 Z'],
  },

  bastion: {
    ink: [
      'M 24 34 L 76 34 L 76 100 L 24 100 Z',
      'M 18 28 L 82 28 L 82 38 L 18 38 Z',
      'M 16 16 L 28 16 L 28 30 L 16 30 Z M 36 16 L 48 16 L 48 30 L 36 30 Z M 54 16 L 66 16 L 66 30 L 54 30 Z M 72 16 L 84 16 L 84 30 L 72 30 Z',
    ],
    cut: ['M 45 46 L 55 46 L 55 68 L 45 68 Z', 'M 40 80 Q 50 68 60 80 L 60 100 L 40 100 Z'],
  },

  warden: {
    ink: [
      'M 42 8 Q 58 8 58 22 Q 58 34 42 34 Q 30 34 30 22 Q 30 8 42 8 Z',
      'M 28 34 L 58 34 L 66 100 L 20 100 Z',
      'M 74 16 L 82 16 L 82 100 L 74 100 Z M 78 0 Q 88 0 88 10 Q 88 20 78 20 Q 68 20 68 10 Q 68 0 78 0 Z',
    ],
    cut: ['M 26 62 L 62 62 L 62 70 L 26 70 Z'],
  },

  herald: {
    ink: [
      'M 10 44 L 62 38 L 62 58 L 10 56 Z',
      'M 62 26 L 92 14 L 92 78 L 62 68 Z',
      'M 28 56 L 58 56 L 58 94 L 43 86 L 28 94 Z',
    ],
    cut: ['M 43 64 L 50 74 L 43 82 L 36 74 Z'],
  },

  oracle: {
    ink: [
      'M 6 52 Q 50 12 94 52 Q 50 92 6 52 Z',
      'M 47 2 L 53 2 L 53 16 L 47 16 Z M 12 16 L 17 12 L 26 24 L 21 28 Z M 88 16 L 83 12 L 74 24 L 79 28 Z',
    ],
    cut: ['M 50 34 Q 66 34 66 52 Q 66 70 50 70 Q 34 70 34 52 Q 34 34 50 34 Z'],
  },

  effigy: {
    ink: ['M 26 12 L 74 12 L 74 92 L 26 92 Z', 'M 14 92 L 86 92 L 86 100 L 14 100 Z'],
    cut: [
      'M 35 30 L 46 30 L 46 42 L 35 42 Z M 54 30 L 65 30 L 65 42 L 54 42 Z',
      'M 36 56 L 64 56 L 64 64 L 36 64 Z',
      'M 32 74 L 50 68 L 68 74 L 68 82 L 50 76 L 32 82 Z',
    ],
  },

  grimoire: {
    ink: ['M 16 22 L 84 22 L 84 88 L 16 88 Z', 'M 12 22 L 26 22 L 26 88 L 12 88 Z'],
    cut: [
      'M 76 28 L 88 28 L 88 82 L 76 82 Z',
      'M 44 48 L 56 48 L 56 62 L 44 62 Z',
      'M 50 30 L 58 42 L 50 46 L 42 42 Z',
    ],
  },

  seraph: {
    ink: [
      'M 50 20 Q 60 20 60 32 Q 60 42 50 42 Q 40 42 40 32 Q 40 20 50 20 Z M 40 42 L 60 42 L 68 92 L 32 92 Z',
      'M 40 46 Q 8 34 4 68 Q 24 62 40 74 Z',
      'M 60 46 Q 92 34 96 68 Q 76 62 60 74 Z',
      'M 30 92 L 70 92 L 70 100 L 30 100 Z',
    ],
    cut: [
      'M 50 4 Q 68 4 68 12 Q 68 20 50 20 Q 32 20 32 12 Q 32 4 50 4 Z M 50 10 Q 40 10 40 12 Q 40 14 50 14 Q 60 14 60 12 Q 60 10 50 10 Z',
    ],
  },

  cairn: {
    ink: [
      'M 16 84 Q 26 70 50 70 Q 76 70 86 84 Q 86 98 50 98 Q 14 98 16 84 Z',
      'M 28 56 Q 50 48 70 56 Q 74 66 50 68 Q 26 66 28 56 Z',
      'M 38 34 Q 50 26 62 34 Q 64 44 50 46 Q 36 44 38 34 Z',
      'M 44 16 Q 50 10 58 16 Q 58 26 50 30 Q 42 28 44 16 Z',
    ],
  },

  ossuary: {
    ink: [
      'M 30 44 L 70 44 Q 82 70 70 92 L 30 92 Q 18 70 30 44 Z',
      'M 22 32 L 78 32 L 78 46 L 22 46 Z',
    ],
    cut: ['M 26 60 L 74 84 L 70 90 L 22 66 Z', 'M 74 60 L 26 84 L 30 90 L 78 66 Z'],
  },

  doom: {
    ink: [
      'M 14 6 L 86 6 L 86 18 L 14 18 Z M 14 88 L 86 88 L 86 100 L 14 100 Z M 20 6 L 30 6 L 30 100 L 20 100 Z M 70 6 L 80 6 L 80 100 L 70 100 Z',
      'M 34 18 L 66 18 L 52 53 L 66 88 L 34 88 L 48 53 Z',
    ],
    cut: ['M 38 22 L 62 22 L 52 44 L 48 44 Z', 'M 40 84 L 60 84 L 55 72 L 45 72 Z'],
  },

  shield: {
    ink: ['M 12 12 L 88 12 L 88 52 Q 88 86 50 98 Q 12 86 12 52 Z'],
    cut: [
      'M 22 28 L 50 42 L 78 28 L 78 40 L 50 54 L 22 40 Z',
      'M 50 62 Q 62 62 62 74 Q 62 86 50 86 Q 38 86 38 74 Q 38 62 50 62 Z',
    ],
  },

  skirmisher: {
    ink: [
      'M 34 12 Q 48 12 48 24 Q 48 36 34 36 Q 22 36 22 24 Q 22 12 34 12 Z',
      'M 20 38 L 48 38 L 54 70 L 46 70 L 52 100 L 40 100 L 34 76 L 26 100 L 14 100 L 22 68 Z',
      'M 66 16 L 74 16 L 74 100 L 66 100 Z M 70 0 L 82 18 L 58 18 Z',
    ],
    cut: ['M 24 46 L 46 46 L 46 54 L 24 54 Z'],
  },

  runner: {
    ink: [
      'M 62 10 Q 76 10 76 22 Q 76 34 62 34 Q 50 34 50 22 Q 50 10 62 10 Z',
      'M 44 36 L 66 30 L 74 56 L 52 62 Z',
      'M 46 38 L 20 30 L 16 40 L 44 50 Z M 68 36 L 90 46 L 86 56 L 64 48 Z',
      'M 54 58 L 70 56 L 78 84 L 92 98 L 78 100 L 62 82 Z',
      'M 52 58 L 62 62 L 44 82 L 46 100 L 32 100 L 28 80 Z',
    ],
  },

  beast: {
    ink: [
      'M 22 48 L 70 48 Q 82 48 82 62 L 82 74 L 22 74 Z',
      'M 70 34 L 94 34 L 96 56 L 70 58 Z',
      'M 72 34 L 66 14 L 74 14 L 80 32 Z M 88 34 L 92 14 L 100 18 L 96 34 Z',
      'M 26 74 L 36 74 L 36 100 L 26 100 Z M 52 74 L 62 74 L 62 100 L 52 100 Z M 70 74 L 80 74 L 80 100 L 70 100 Z',
      'M 22 50 L 6 38 L 0 48 L 20 62 Z',
    ],
    cut: ['M 84 40 L 90 40 L 90 46 L 84 46 Z'],
  },

  yeoman: {
    ink: [
      'M 30 6 Q 70 30 70 50 Q 70 70 30 94 L 30 84 Q 58 66 58 50 Q 58 34 30 16 Z',
      'M 27 8 L 33 8 L 33 92 L 27 92 Z',
      'M 4 46 L 56 46 L 56 54 L 4 54 Z M 56 41 L 76 50 L 56 59 Z M 4 40 L 18 50 L 4 60 Z',
    ],
  },

  scythe: {
    ink: [
      'M 56 12 L 66 12 L 52 96 L 42 96 Z',
      'M 60 14 Q 26 14 10 44 L 20 50 Q 34 26 62 26 Z',
      'M 40 48 L 62 44 L 64 52 L 42 56 Z',
    ],
  },

  barrel: {
    ink: [
      'M 30 22 L 70 22 Q 88 50 70 96 L 30 96 Q 12 50 30 22 Z',
      'M 30 22 L 70 22 L 70 30 L 30 30 Z',
    ],
    cut: [
      'M 16 44 L 84 44 L 84 52 L 16 52 Z M 16 68 L 84 68 L 84 76 L 16 76 Z',
      'M 48 30 L 52 30 L 52 96 L 48 96 Z',
    ],
  },

  flail: {
    ink: [
      'M 18 98 L 28 96 L 46 44 L 36 40 Z',
      'M 36 34 L 48 30 L 52 44 L 40 48 Z',
      'M 46 30 L 54 22 L 90 42 L 84 52 Z',
    ],
    cut: ['M 38 36 L 50 32 L 52 38 L 40 42 Z'],
  },

  golem: {
    ink: [
      'M 36 10 L 64 10 L 64 30 L 36 30 Z',
      'M 26 34 L 74 34 L 74 70 L 26 70 Z',
      'M 8 34 L 24 34 L 24 78 L 8 78 Z M 76 34 L 92 34 L 92 78 L 76 78 Z',
      'M 30 74 L 46 74 L 46 100 L 30 100 Z M 54 74 L 70 74 L 70 100 L 54 100 Z',
    ],
    cut: ['M 40 16 L 60 16 L 60 23 L 40 23 Z', 'M 50 42 L 60 52 L 50 62 L 40 52 Z'],
  },

  furrows: {
    ink: [
      'M 0 50 L 100 50 L 100 58 L 0 58 Z',
      'M 4 66 Q 50 58 96 66 L 96 72 Q 50 64 4 72 Z M 2 80 Q 50 72 98 80 L 98 86 Q 50 78 2 86 Z M 0 94 Q 50 86 100 94 L 100 100 Q 50 92 0 100 Z',
    ],
    cut: ['M 68 26 Q 84 26 84 42 Q 84 50 68 50 Q 52 50 52 42 Q 52 26 68 26 Z'],
  },

  trees: {
    ink: [
      'M 24 96 L 4 96 L 14 46 Z M 52 96 L 26 96 L 39 24 Z M 96 96 L 70 96 L 83 38 Z',
      'M 12 94 L 16 94 L 16 100 L 12 100 Z M 37 94 L 41 94 L 41 100 L 37 100 Z M 81 94 L 85 94 L 85 100 L 81 100 Z',
    ],
  },

  well: {
    ink: [
      'M 24 62 L 76 62 L 76 98 L 24 98 Z',
      'M 50 6 L 88 28 L 12 28 Z',
      'M 30 28 L 38 28 L 38 62 L 30 62 Z M 62 28 L 70 28 L 70 62 L 62 62 Z',
      'M 24 56 L 76 56 L 76 64 L 24 64 Z',
    ],
    cut: [
      'M 30 70 L 46 70 L 46 78 L 30 78 Z M 54 70 L 70 70 L 70 78 L 54 78 Z M 38 84 L 62 84 L 62 92 L 38 92 Z',
    ],
  },

  vent: {
    ink: [
      'M 0 86 L 36 86 L 50 76 L 64 86 L 100 86 L 100 100 L 0 100 Z',
      'M 50 12 Q 66 40 62 56 Q 78 48 74 34 Q 88 58 74 78 Q 62 90 50 90 Q 30 90 24 74 Q 18 56 32 40 Q 30 56 40 58 Q 36 36 50 12 Z',
    ],
    cut: ['M 50 44 Q 62 60 58 74 Q 52 84 44 78 Q 38 70 44 60 Q 46 52 50 44 Z'],
  },

  marsh: {
    ink: [
      'M 0 78 L 100 78 L 100 100 L 0 100 Z',
      'M 20 30 L 26 30 L 26 78 L 20 78 Z M 40 20 L 46 20 L 46 78 L 40 78 Z M 60 34 L 66 34 L 66 78 L 60 78 Z M 78 26 L 84 26 L 84 78 L 78 78 Z',
      'M 20 22 Q 23 12 26 22 L 26 34 L 20 34 Z M 40 12 Q 43 2 46 12 L 46 24 L 40 24 Z M 60 26 Q 63 16 66 26 L 66 38 L 60 38 Z M 78 18 Q 81 8 84 18 L 84 30 L 78 30 Z',
    ],
    cut: [
      'M 8 86 Q 24 82 40 86 L 40 90 Q 24 86 8 90 Z M 56 88 Q 72 84 90 88 L 90 92 Q 72 88 56 92 Z',
    ],
  },

  saltflat: {
    ink: [
      'M 0 74 L 100 74 L 100 100 L 0 100 Z',
      'M 24 74 L 33 50 L 42 74 Z M 46 74 L 56 38 L 66 74 Z M 66 74 L 73 56 L 80 74 Z',
    ],
    cut: [
      'M 10 82 L 44 82 L 44 86 L 10 86 Z M 52 90 L 92 90 L 92 94 L 52 94 Z M 30 90 L 34 90 L 34 100 L 30 100 Z',
    ],
  },

  headland: {
    ink: [
      'M 0 34 L 58 34 L 58 42 L 0 42 Z',
      'M 0 40 L 58 40 L 58 78 L 0 78 Z M 58 40 L 76 78 L 58 78 Z',
      'M 0 82 L 100 82 L 100 100 L 0 100 Z',
    ],
    cut: ['M 62 88 Q 76 84 90 88 L 90 93 Q 76 89 62 93 Z'],
  },

  coldframe: {
    ink: ['M 14 66 L 86 66 L 86 96 L 14 96 Z', 'M 10 56 L 90 40 L 92 50 L 12 66 Z'],
    cut: [
      'M 30 51 L 35 50 L 35 63 L 30 64 Z M 52 47 L 57 46 L 57 59 L 52 60 Z M 74 43 L 79 42 L 79 55 L 74 56 Z',
    ],
  },

  haybales: {
    ink: [
      'M 26 62 Q 48 62 48 80 Q 48 98 26 98 Q 4 98 4 80 Q 4 62 26 62 Z',
      'M 74 62 Q 96 62 96 80 Q 96 98 74 98 Q 52 98 52 80 Q 52 62 74 62 Z',
      'M 50 26 Q 72 26 72 44 Q 72 60 50 60 Q 28 60 28 44 Q 28 26 50 26 Z',
    ],
    cut: [
      'M 26 70 Q 38 70 38 80 Q 38 90 26 90 Q 18 90 18 84 L 24 84 Q 24 86 26 86 Q 32 86 32 80 Q 32 74 26 74 Z',
      'M 74 70 Q 86 70 86 80 Q 86 90 74 90 Q 66 90 66 84 L 72 84 Q 72 86 74 86 Q 80 86 80 80 Q 80 74 74 74 Z',
    ],
  },

  hedge: {
    ink: [
      'M 6 94 Q 4 60 26 58 Q 34 40 52 46 Q 72 38 80 58 Q 98 62 94 94 Z',
      'M 0 92 L 100 92 L 100 100 L 0 100 Z',
    ],
    cut: [
      'M 30 66 Q 38 58 44 66 Q 38 74 30 66 Z M 56 60 Q 64 52 70 60 Q 64 68 56 60 Z M 44 80 Q 52 72 58 80 Q 52 88 44 80 Z',
    ],
  },

  gate: {
    ink: [
      'M 8 30 L 18 30 L 18 100 L 8 100 Z M 82 30 L 92 30 L 92 100 L 82 100 Z',
      'M 18 38 L 82 38 L 82 46 L 18 46 Z M 18 54 L 82 54 L 82 62 L 18 62 Z M 18 70 L 82 70 L 82 78 L 18 78 Z M 18 86 L 82 86 L 82 94 L 18 94 Z',
      'M 20 90 L 76 40 L 82 47 L 26 97 Z',
    ],
  },

  turnip: {
    ink: [
      'M 50 46 Q 78 46 78 70 Q 78 96 50 96 Q 22 96 22 70 Q 22 46 50 46 Z',
      'M 46 46 Q 28 30 14 34 Q 22 12 46 34 Z M 54 46 Q 72 28 88 32 Q 78 10 54 34 Z',
      'M 46 44 L 54 44 L 54 18 L 46 18 Z',
    ],
    cut: ['M 34 62 Q 38 78 48 86 L 40 88 Q 30 78 28 64 Z'],
  },
};

/** Every noun the card-name grammar can produce, mapped to the motif it wears. */
const CITY_MOTIFS: Record<string, Motif> = {
  rooftops: {
    ink: [
      'M6 100 L6 54 L32 54 L32 100 Z',
      'M32 100 L32 36 L58 36 L58 100 Z',
      'M58 100 L58 64 L78 64 L78 100 Z',
      'M78 100 L78 46 L96 46 L96 100 Z',
    ],
    cut: [
      'M12 62 L19 62 L19 71 L12 71 Z M23 62 L30 62 L30 71 L23 71 Z',
      'M38 44 L45 44 L45 53 L38 53 Z M48 44 L55 44 L55 53 L48 53 Z',
      'M38 36 L38 27 L54 27 L54 36 Z',
      'M84 54 L91 54 L91 63 L84 63 Z',
    ],
  },
  stairwell: {
    ink: [
      'M14 100 L14 16 L38 16 L38 100 Z',
      'M38 100 L38 86 L56 86 L56 71 L74 71 L74 56 L92 56 L92 100 Z',
    ],
    cut: ['M21 28 L31 28 L31 40 L21 40 Z', 'M21 50 L31 50 L31 62 L21 62 Z'],
  },
};

Object.assign(MOTIFS, CITY_MOTIFS);

export const NOUN_ART: Record<string, string> = {
  Mumbai: 'rooftops',
  Nairobi: 'stairwell',
  Lagos: 'stairwell',
  Manila: 'rooftops',
  'Rio de Janeiro': 'stairwell',
  'Cape Town': 'rooftops',
  Karachi: 'rooftops',
  'Mexico City': 'rooftops',
  Caracas: 'stairwell',
  'Port-au-Prince': 'rooftops',
  Jakarta: 'stairwell',
  Dhaka: 'rooftops',
  Stepladder: 'ladder',
  'Dish Rack': 'rack',
  'Trouser Press': 'board',
  Colander: 'colander',
  'Draining Board': 'board',
  'Bread Box': 'box',
  'Coat Hook': 'hook',
  'Nail Brush': 'brush',
  Doorstop: 'wedge',
  'Extension Cord': 'cord',
  'Dish Towel': 'cloth',
  'Sock Drawer': 'drawer',
  'Ironing Board': 'board',
  'Trash Bag': 'sack',
  'Fuse Box': 'box',
  Baseboard: 'board',
  'Draft Stopper': 'wedge',
  'Attic Hatch': 'door',
  'Cake Tin': 'dish',
  'Gravy Boat': 'dish',
  'Egg Cup': 'eggcup',
  'Spirit Level': 'level',
  'Trash Can': 'bucket',
  'Bath Mat': 'cloth',
  'Shoe Horn': 'hook',
  'Letter Rack': 'rack',
  'Napkin Ring': 'ring',
  Lampshade: 'lampshade',
  'Mop Bucket': 'bucket',
  'Drying Rack': 'rack',
  Pillowcase: 'cloth',
  'Hot Water Bottle': 'bottle',
  'Radiator Key': 'key',
  'Rolling Pin': 'pin',
  'Casserole Dish': 'dish',
  'Lint Trap': 'colander',
  'Box Fan': 'fan',
  'Storm Door': 'door',
  'Slow Cooker': 'dish',
  'Weed Whacker': 'whacker',
  'Screen Door': 'door',
  'Garden Hose': 'cord',
  Wheelbarrow: 'barrow',
  'Milk Crate': 'box',
  'Broom Closet': 'door',
  'Junk Drawer': 'drawer',

  Wyrm: 'wyrm',
  Revenant: 'revenant',
  Covenant: 'scroll',
  Sigil: 'sigil',
  Reliquary: 'reliquary',
  Bastion: 'bastion',
  Warden: 'warden',
  Herald: 'herald',
  Oracle: 'oracle',
  Effigy: 'effigy',
  Grimoire: 'grimoire',
  Bulwark: 'bastion',
  Thrall: 'revenant',
  Seraph: 'seraph',
  Basilisk: 'wyrm',
  Geas: 'scroll',
  Cairn: 'cairn',
  Wight: 'revenant',
  Idol: 'effigy',
  Rite: 'scroll',
  Ossuary: 'ossuary',
  Lament: 'ossuary',
  Aegis: 'shield',
  Doom: 'doom',

  Sentinel: 'warden',
  Skirmisher: 'skirmisher',
  Adept: 'oracle',
  Drake: 'drake',
  Pilgrim: 'warden',
  Runner: 'runner',
  Sprite: 'seraph',
  Beast: 'beast',
  Yeoman: 'yeoman',
  Harvester: 'scythe',
  Cooper: 'barrel',
  Reeve: 'warden',
  'Artifact Sentinel': 'golem',
  'Spirit Beast': 'beast',
  Thresher: 'flail',
  'Hedge Knight': 'shield',
  Drover: 'warden',

  'Fallow Acre': 'furrows',
  Deepwood: 'trees',
  Wellspring: 'well',
  'Ember Vent': 'vent',
  'The Back Forty': 'furrows',
  Marshpath: 'marsh',
  'Bottom Meadow': 'furrows',
  Saltflat: 'saltflat',
  'Long Headland': 'headland',
  'Cold Frame': 'coldframe',
  'Stony Ridge': 'cairn',
  'The Nine Acre': 'furrows',
  'Drainage Ditch': 'marsh',
  'Wind Row': 'haybales',
  'Silage Clamp': 'haybales',
  'Hazel Hedge': 'hedge',
  'Low Paddock': 'gate',
  'Turnip Field': 'turnip',
};

/** Longest first, so 'Dish Towel' wins over 'Dish Rack' and 'Artifact Sentinel' over 'Sentinel'. */
const NOUNS_BY_LENGTH = Object.keys(NOUN_ART).sort((a, b) => b.length - a.length);

const GENERIC = 'sigil';
const GENERIC_LAND = 'furrows';

/** The motif a card wears: its noun if the name carries one, else its type. */
export function motifFor(name: string, type: string, land: boolean): Motif | undefined {
  for (const noun of NOUNS_BY_LENGTH) {
    if (name.includes(noun)) return MOTIFS[NOUN_ART[noun]!];
  }
  if (!land) {
    const byType = NOUN_ART[type];
    if (byType) return MOTIFS[byType];
  }
  return MOTIFS[land ? GENERIC_LAND : GENERIC];
}
