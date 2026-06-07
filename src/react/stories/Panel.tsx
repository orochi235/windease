const COLOR_CLASSES = [
  'story-panel--red',
  'story-panel--green',
  'story-panel--blue',
  'story-panel--amber',
  'story-panel--purple',
  'story-panel--pink',
  'story-panel--teal',
] as const;

export function colorClassForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLOR_CLASSES[hash % COLOR_CLASSES.length] as string;
}
