import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Group, Panel, Zone } from './presets.js';

describe('preset components', () => {
  it('Panel renders a windease-panel div with optional title', () => {
    const { container } = render(<Panel title="Hello">body</Panel>);
    const root = container.firstChild as HTMLDivElement;
    expect(root.className).toContain('windease-panel');
    expect(root.querySelector('.windease-panel__title')?.textContent).toBe('Hello');
    expect(root.textContent).toContain('body');
  });

  it('Panel without title omits the header', () => {
    const { container } = render(<Panel>only body</Panel>);
    const root = container.firstChild as HTMLDivElement;
    expect(root.querySelector('.windease-panel__title')).toBeNull();
  });

  it('Group renders a windease-group div with optional title', () => {
    const { container } = render(<Group title="grp">child</Group>);
    const root = container.firstChild as HTMLDivElement;
    expect(root.className).toContain('windease-group');
    expect(root.querySelector('.windease-group__title')?.textContent).toBe('grp');
  });

  it('Zone renders a windease-zone div', () => {
    const { container } = render(<Zone>child</Zone>);
    const root = container.firstChild as HTMLDivElement;
    expect(root.className).toContain('windease-zone');
    expect(root.textContent).toContain('child');
  });

  it('preset className composes with the default', () => {
    const { container } = render(<Panel className="extra" />);
    const root = container.firstChild as HTMLDivElement;
    expect(root.className).toBe('windease-panel extra');
  });

  it('preset style is forwarded to the root div', () => {
    const { container } = render(<Zone style={{ backgroundColor: 'red' }} />);
    const root = container.firstChild as HTMLDivElement;
    expect(root.style.backgroundColor).toBe('red');
  });
});
