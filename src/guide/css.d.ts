// Same reason as src/react/stories/css.d.ts: TS 6 (TS2882) needs side-effect
// CSS imports to resolve. Scoped to this dir so the published build never
// gains a blanket '*.css' declaration — src/guide is excluded from it.
declare module '*.css';
