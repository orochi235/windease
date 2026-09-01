import type { GlobalProvider } from '@ladle/react';
import './ladle.css';

/** Ladle mounts this around every story. It exists only to pull `ladle.css`
 *  into the bundle — the stories themselves need nothing from it. */
export const Provider: GlobalProvider = ({ children }) => children;
