// The Node surface the sweep uses. @types/node would do, but with no `types` field in
// tsconfig.json it would also reach the library's own typecheck, which must stay Node-free.

declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  export function writeFileSync(path: string | URL, data: string): void;
}

declare const process: {
  argv: string[];
  stdout: { write(chunk: string): boolean };
  exitCode?: number;
};
