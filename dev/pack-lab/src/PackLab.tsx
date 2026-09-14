import { Lab } from '@weasel-js/labkit';
import '@weasel-js/labkit/styles.css';
import { compare } from './instruments/compare.js';
import { matrix } from './instruments/matrix.js';
import { single } from './instruments/single.js';
import './lab.css';

export function PackLab({ storageKey }: { storageKey?: string }) {
  return (
    <Lab
      instruments={[single, compare, matrix]}
      defaultInstrument="Compare"
      title="Pack lab"
      {...(storageKey === undefined ? {} : { storageKey })}
    />
  );
}
