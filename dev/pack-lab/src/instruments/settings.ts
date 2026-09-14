import { f } from '@weasel-js/labkit';
import { PACKERS } from '../core/packers.js';

/** Container and packer fields, spread into every instrument's schema. */
export const settingsFields = () => ({
  fit: f.enum('aspect', ['aspect', 'width']).label('Fit').section('Container'),
  aspect: f
    .number(1.6)
    .range(0.25, 4)
    .step(0.05)
    .label('Aspect')
    .showIf((c) => c.fit === 'aspect'),
  width: f
    .number(480)
    .range(40, 2400)
    .step(10)
    .label('Width')
    .showIf((c) => c.fit === 'width'),
  useHints: f.boolean(true).label("Use the dataset's settings").section('Packer options'),
  gap: f.number(8).range(0, 64).step(1).label('Gap'),
  columnWidth: f.number(0).range(0, 400).step(1).label('Column width (0: narrowest item)'),
});

/** One on/off per registered packer, keyed by packer id. */
export const packerToggles = () =>
  f
    .group(Object.fromEntries(PACKERS.map((p) => [p.id, f.boolean(true).label(p.id)])))
    .label('Packers');
