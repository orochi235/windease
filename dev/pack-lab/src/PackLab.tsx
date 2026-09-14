import { Lab, type StorageAdapter } from '@weasel-js/labkit';
import '@weasel-js/labkit/styles.css';
import { compare } from './instruments/compare.js';
import { matrix } from './instruments/matrix.js';
import { single } from './instruments/single.js';
import './lab.css';

export function PackLab({
  storage,
  storageKey,
}: {
  storage?: StorageAdapter;
  storageKey?: string;
}) {
  return (
    <Lab
      instruments={[single, compare, matrix]}
      defaultInstrument="Compare"
      title="Pack lab"
      {...(storage === undefined ? {} : { storage })}
      {...(storageKey === undefined ? {} : { storageKey })}
    />
  );
}
