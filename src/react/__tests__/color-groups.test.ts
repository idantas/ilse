import { describe, expect, it } from 'vitest';
import { groupColors } from '../color-groups.js';

// The colours of a real project (SAC regulatório), in the order its CSS declares them
const SAC = ['surface-1', 'surface-2', 'surface-3', 'shadow-color', 'hover', 'active', 'selected', 'destructive-light', 'focus-ring',
  'dm-hi-base', 'dm-hi-mid', 'dm-ring-base', 'dm-drop', 'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground',
  'destructive', 'destructive-foreground', 'success', 'success-foreground', 'warning', 'warning-foreground', 'border', 'input',
  'grade-vazia', 'grade-cheia', 'chart-2', 'chart-3', 'sidebar', 'sidebar-foreground', 'sidebar-border', 'sidebar-ring', 'chart-1',
  'fundo-do-console', 'elo-2', 'malha-1', 'malha-2', 'terreno-glifo'];

const view = (names: string[]) => Object.fromEntries(groupColors(names).map(g => [g.family ?? g.role, g.items.map(i => i.on ? `${i.name}/${i.on}` : i.name)]));

describe('groupColors', () => {
  it('groups by what each colour is for, each fill with the text that goes on it', () => {
    expect(view(SAC)).toEqual({
      brand: ['primary/primary-foreground', 'secondary/secondary-foreground', 'accent/accent-foreground'],
      surface: ['surface-1', 'surface-2', 'surface-3', 'background', 'card/card-foreground', 'popover/popover-foreground', 'muted/muted-foreground', 'fundo-do-console'],
      text: ['foreground'],
      border: ['focus-ring', 'border', 'input'],
      state: ['hover', 'active', 'selected'],
      status: ['destructive-light', 'destructive/destructive-foreground', 'success/success-foreground', 'warning/warning-foreground'],
      data: ['chart-1', 'chart-2', 'chart-3'],
      dm: ['dm-hi-base', 'dm-hi-mid', 'dm-ring-base', 'dm-drop'],
      grade: ['grade-vazia', 'grade-cheia'],
      malha: ['malha-1', 'malha-2'],
      sidebar: ['sidebar/sidebar-foreground', 'sidebar-border', 'sidebar-ring'],
      other: ['shadow-color', 'elo-2', 'terreno-glifo'],
    });
  });

  it('puts roles first, in a fixed order, and families after', () => {
    expect(groupColors(SAC).map(g => g.family ?? g.role)).toEqual(['brand', 'surface', 'text', 'border', 'state', 'status', 'data', 'dm', 'grade', 'malha', 'sidebar', 'other']);
  });

  it('keeps numbered steps in order', () => {
    expect(view(['surface-10', 'surface-2', 'surface-1'])).toEqual({ surface: ['surface-1', 'surface-2', 'surface-10'] });
  });
});
