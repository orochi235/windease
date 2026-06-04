import type { WindowId, WindowRecord, ZoneId } from './window.js';

export interface Placement {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutInput {
  zone: ZoneRecord;
  windows: WindowRecord[];
  viewport: { w: number; h: number };
}

export interface LayoutStrategy {
  name: string;
  layout(input: LayoutInput): Map<WindowId, Placement>;
}

export interface ZoneRecord {
  id: ZoneId;
  strategy: LayoutStrategy;
  windowIds: WindowId[];
  config: Record<string, unknown>;
}

export interface CreateZoneInput {
  id: ZoneId;
  strategy: LayoutStrategy;
  config?: Record<string, unknown>;
}

export function createZoneRecord(input: CreateZoneInput): ZoneRecord {
  return {
    id: input.id,
    strategy: input.strategy,
    windowIds: [],
    config: input.config ?? {},
  };
}
