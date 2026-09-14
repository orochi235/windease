import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PackLab } from './PackLab.js';
import './page.css';

const root = document.getElementById('root');
if (!root) throw new Error('pack lab: the page has no #root');

createRoot(root).render(
  <StrictMode>
    <PackLab storageKey="windease-pack-lab" />
  </StrictMode>,
);
