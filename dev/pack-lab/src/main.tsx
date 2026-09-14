import { Lab } from '@weasel-js/labkit';
import '@weasel-js/labkit/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { compare } from './instruments/compare.js';
import { matrix } from './instruments/matrix.js';
import { single } from './instruments/single.js';
import './lab.css';

const root = document.getElementById('root');
if (!root) throw new Error('pack lab: the page has no #root');

createRoot(root).render(
  <StrictMode>
    <Lab
      instruments={[single, compare, matrix]}
      defaultInstrument="Compare"
      title="Pack lab"
      storageKey="windease-pack-lab"
    />
  </StrictMode>,
);
