import { f } from '@weasel-js/labkit';
import { ENGINE_SORTS, type EngineSort } from '../core/engine/order.js';
import { PACKERS } from '../core/packers.js';
import { STORY_BOXES } from '../core/sample.js';
import { DATASETS } from '../datasets.js';

export const datasetField = () =>
  f
    .enum<string>(
      STORY_BOXES.id,
      DATASETS.map((d) => ({ value: d.id, label: d.label })),
    )
    .label('Dataset');

/** Container and packer fields, spread into every instrument's schema. */
export const settingsFields = () => ({
  fit: f.enum('aspect', ['aspect', 'width']).label('Fit').section('Container'),
  aspect: f
    .number(1.6)
    .range(0.25, 4)
    .step(0.05)
    .label('Aspect (unless the dataset sets one)')
    .section('Container')
    .showIf((c) => c.fit === 'aspect'),
  width: f
    .number(480)
    .range(40, 2400)
    .step(10)
    .label('Width')
    .section('Container')
    .showIf((c) => c.fit === 'width'),
  useHints: f.boolean(true).label("Use the dataset's settings").section('Packer options'),
  gap: f
    .number(8)
    .range(0, 64)
    .step(1)
    .label('Gap (unless the dataset sets one)')
    .section('Packer options'),
  columnWidth: f
    .number(0)
    .range(0, 400)
    .step(1)
    .label('Column width (unless the dataset sets one; 0 = narrowest item)')
    .section('Packer options'),
  sort: f
    .enum<EngineSort>('none', [...ENGINE_SORTS])
    .label('Sort, largest first (perimeter and height-width: engine recipes only)')
    .section('Packer options'),
  rotate: f
    .boolean(false)
    .label('Rotate a quarter where that fits better')
    .section('Packer options'),
});

/** One on/off per registered packer, keyed by packer id. */
export const packerToggles = () =>
  f
    .group(Object.fromEntries(PACKERS.map((p) => [p.id, f.boolean(p.on).label(p.id)])))
    .label('Packers');
