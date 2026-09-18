import { createContext } from 'react';

/**
 * True while this container or one around it is being resized by a seam drag.
 * The pointer is the motion then, so nothing inside should ease toward its new
 * rect: a nested container's panes would trail the box that holds them.
 */
export const ResizeGestureContext = createContext(false);
