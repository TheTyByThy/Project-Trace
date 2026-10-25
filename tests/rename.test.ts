// Renaming a channel must update every reference to it (graphs, components, properties, expressions).
import { describe, expect, it } from 'vitest';
import { createComponent } from '../src/state/components';
import { renameChannelsInWorkspace, renameInExpression } from '../src/state/renameChannels';
import type { GraphConfig, ScatterConfig, Workspace } from '../src/state/workspace';

const map = (pairs: [string, string][]) => new Map(pairs);

describe('renameInExpression', () => {
  it('rewrites quoted names and bare identifiers, but not function calls', () => {
    expect(renameInExpression("'Brake Bal' * 2 + Bal", map([['Brake Bal', 'Brake Balance'], ['Bal', 'Balance']]))).toBe("'Brake Balance' * 2 + Balance");
    expect(renameInExpression('abs(x) + x', map([['abs', 'nope'], ['x', 'y']]))).toBe('abs(y) + y');
  });
  it('quotes a new name that has spaces', () => {
    expect(renameInExpression('Coast * 100', map([['Coast', 'Coasting %']]))).toBe("'Coasting %' * 100");
  });
  it('keeps the quote style and units', () => {
    expect(renameInExpression('"Old" [kph] / 3.6', map([['Old', 'New']]))).toBe('"New" [kph] / 3.6');
  });
  it('leaves other names alone', () => {
    expect(renameInExpression("'Old Thing' + Old2", map([['Old', 'New']]))).toBe("'Old Thing' + Old2");
  });
});

describe('renameChannelsInWorkspace', () => {
  it('updates graphs, components, channel properties and other math channels', () => {
    const g = createComponent('graph', { panes: [{ id: 'p', channels: ['Old', 'Ground Speed'], hidden: ['Old'], weight: 1, scale: 'auto' }] } as Partial<GraphConfig>) as GraphConfig;
    const sc = createComponent('scatter', { x: 'Old', y: 'Ground Speed', color: 'Old' } as Partial<ScatterConfig>) as ScatterConfig;
    const ws: Workspace = {
      id: 'w',
      name: 'W',
      version: 1,
      activeSheet: 0,
      createdAt: 0,
      updatedAt: 0,
      constants: [],
      channelProps: { Old: { color: '#ffffff' } },
      math: [
        { id: 'a', name: 'New', expr: "'Ground Speed' / 2", unit: '', enabled: true },
        { id: 'b', name: 'Uses it', expr: 'Old * 2', unit: '', enabled: true },
      ],
      worksheets: [{ id: 's', name: 'S', layout: null, components: { [g.id]: g, [sc.id]: sc } }],
    };
    const out = renameChannelsInWorkspace(ws, map([['Old', 'New']]));
    const og = out.worksheets[0].components[g.id] as GraphConfig;
    const os = out.worksheets[0].components[sc.id] as ScatterConfig;
    expect(og.panes[0].channels).toEqual(['New', 'Ground Speed']);
    expect(og.panes[0].hidden).toEqual(['New']);
    expect([os.x, os.color]).toEqual(['New', 'New']);
    expect(out.channelProps).toEqual({ New: { color: '#ffffff' } });
    expect(out.math[1].expr).toBe('New * 2');
  });
});
