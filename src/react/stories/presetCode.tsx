import { createElement, type ReactElement, useState } from 'react';
import type { Size } from '../../layout-types.js';
import { asNodeId } from '../../node.js';
import {
  type Preset,
  type PresetData,
  type PresetNode,
  presetProperties,
  presetTree,
} from '../../test-utils/exotic/preset.js';
import { Panel, Zone } from '../index.js';
import { StrategyMap } from './StrategyMap.js';

/** Children shown per container before a listing elides the rest. */
const SHOWN_CHILDREN = 8;

/** The props one preset node becomes, shared by the element tree and the listing. */
function nodeProps(node: PresetNode, parentId: string | undefined, preset: Preset) {
  const props: Record<string, unknown> = {};
  if (node.strategy) {
    if (parentId !== undefined) props.parentId = parentId;
    props.id = node.id;
    props.kind = node.kind ?? 'group';
    props.strategyId = node.strategy;
    if (node.config && Object.keys(node.config).length > 0) props.config = node.config;
    if (node.state !== undefined) props.state = node.state;
    if (parentId === undefined) props.viewport = preset.viewport;
  } else {
    props.id = node.id;
    if (node.kind && node.kind !== 'panel') props.kind = node.kind;
  }
  if (node.hints) props.hints = node.hints;
  const { pinned, ...placement } = node.placement ?? {};
  if (Object.keys(placement).length > 0) props.placement = placement;
  if (pinned !== undefined) props.pinned = pinned;
  if (node.meta) props.meta = node.meta;
  if (node.lock !== undefined) props.lock = node.lock;
  if (node.hidden) props.hidden = true;
  return props;
}

/**
 * The preset as declarative windease JSX, mechanics and data merged — the
 * same tree {@link presetJsx} prints, so the listing is exactly what renders.
 */
export function presetElement(preset: Preset): ReactElement {
  const build = (node: PresetNode, parentId?: string): ReactElement => {
    const props = nodeProps(node, parentId, preset);
    const typed = {
      ...props,
      key: node.id,
      id: asNodeId(node.id),
      ...(props.parentId ? { parentId: asNodeId(String(props.parentId)) } : {}),
    };
    if (!node.strategy) return createElement(Panel, typed as never);
    return createElement(
      Zone,
      typed as never,
      ...(node.children ?? []).map((c) => build(c, node.id)),
    );
  };
  return build(presetTree(preset));
}

/** Source text for {@link presetElement}, eliding long child lists. */
export function presetJsx(preset: Preset, shown = SHOWN_CHILDREN): string {
  const lines: string[] = [];
  const emit = (node: PresetNode, depth: number, parentId?: string) => {
    const pad = '  '.repeat(depth);
    const tag = node.strategy ? 'Zone' : 'Panel';
    const attrs = Object.entries(nodeProps(node, parentId, preset)).map(
      ([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : `{${literal(v, 0, shown)}}`}`,
    );
    const children = node.children ?? [];
    const selfClosing = !node.strategy || children.length === 0;
    const close = selfClosing ? ' />' : '>';
    const oneLine = `${pad}<${tag} ${attrs.join(' ')}${close}`;
    if (oneLine.length <= 100 && !oneLine.includes('\n')) lines.push(oneLine);
    else {
      lines.push(`${pad}<${tag}`);
      for (const a of attrs) lines.push(`${pad}  ${a.replaceAll('\n', `\n${pad}  `)}`);
      lines.push(`${pad}${close.trim()}`);
    }
    if (selfClosing) return;
    for (const [i, child] of children.entries()) {
      if (children.length > shown && i === shown - 1) {
        lines.push(`${pad}  {/* …${children.length - shown} more like these */}`);
      }
      if (children.length > shown && i >= shown - 1 && i < children.length - 1) continue;
      emit(child, depth + 1, node.id);
    }
    lines.push(`${pad}</${tag}>`);
  };
  emit(presetTree(preset), 0);
  return lines.join('\n');
}

/** `value` (a preset, its mechanics, its data) as a JS literal, eliding long child lists. */
export function presetLiteral(value: unknown, shown = SHOWN_CHILDREN): string {
  return literal(value, 0, shown);
}

/** `data` without its `css`, or undefined when it holds nothing to show. */
function dataShown(data: PresetData | undefined): Omit<PresetData, 'css'> | undefined {
  const { css: _css, ...rest } = data ?? {};
  const shown = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined && Object.keys(v).length > 0),
  );
  return Object.keys(shown).length > 0 ? shown : undefined;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

function literal(value: unknown, depth: number, shown: number): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string')
    return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
    return String(value);
  }
  if (typeof value !== 'object' || value === null) return String(value);
  const pad = '  '.repeat(depth + 1);
  const end = '  '.repeat(depth);
  if (Array.isArray(value)) {
    const items =
      value.length > shown ? [...value.slice(0, shown - 1), ELIDED, value.at(-1)] : value;
    const parts = items.map((v) =>
      v === ELIDED ? `/* …${value.length - shown} more */` : literal(v, depth + 1, shown),
    );
    const flat = `[${parts.join(', ')}]`;
    if (flat.length <= 72 && !flat.includes('\n')) return flat;
    return `[\n${parts.map((p) => `${pad}${p},`).join('\n')}\n${end}]`;
  }
  const parts = Object.entries(value).map(
    ([k, v]) => `${IDENT.test(k) ? k : literal(k, 0, shown)}: ${literal(v, depth + 1, shown)}`,
  );
  const flat = `{ ${parts.join(', ')} }`;
  if (parts.length === 0) return '{}';
  if (flat.length <= 72 && !flat.includes('\n')) return flat;
  return `{\n${parts.map((p) => `${pad}${p},`).join('\n')}\n${end}}`;
}

const ELIDED = Symbol('elided');

const TABS = [
  ['properties', 'Properties'],
  ['jsx', 'JSX'],
  ['mechanics', 'Mechanics'],
  ['data', 'Data'],
] as const;
type Tab = (typeof TABS)[number][0];

/**
 * Tabs under an Exotic story: what the preset exercises, derived from its
 * tree; the JSX that builds it; and its two halves, the product's layout
 * mechanics and the sample content laid out with them.
 */
export function PresetCode({ preset, viewport }: { preset: Preset; viewport?: Size }) {
  const [tab, setTab] = useState<Tab>('properties');
  return (
    <section className="preset-code" aria-label="Preset details">
      <div className="preset-code__tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`preset-code-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="preset-code-panel"
            className="preset-code__tab"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        id="preset-code-panel"
        role="tabpanel"
        aria-labelledby={`preset-code-tab-${tab}`}
        className={`preset-code__panel preset-code__panel--${tab}`}
        data-testid="preset-code"
      >
        {tab === 'properties' ? (
          <>
            <StrategyMap rootId={preset.mechanics.id} viewport={viewport ?? preset.viewport} />
            <table className="preset-code__properties">
              <tbody>
                {presetProperties(preset).map(({ label, value }) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : tab === 'data' ? (
          <PresetDataListing data={preset.data} />
        ) : (
          <pre className="preset-code__listing">
            <code>{tab === 'jsx' ? presetJsx(preset) : presetLiteral(preset.mechanics)}</code>
          </pre>
        )}
      </div>
    </section>
  );
}

function PresetDataListing({ data }: { data: PresetData | undefined }) {
  const shown = dataShown(data);
  if (!shown && !data?.css) return <p className="preset-code__empty">No sample data</p>;
  return (
    <>
      {shown && (
        <pre className="preset-code__listing">
          <code>{presetLiteral(shown)}</code>
        </pre>
      )}
      {data?.css && (
        <pre className="preset-code__listing preset-code__css">
          <code>{data.css}</code>
        </pre>
      )}
    </>
  );
}
