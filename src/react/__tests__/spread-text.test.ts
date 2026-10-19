import { describe, it, expect } from 'vitest';
import { spreadText } from '../property-panel.js';

describe('spreadText', () => {
  it('keeps the formatted word where it was', () => {
    expect(spreadText(['O que estamos ', 'construindo.'], 'O que vamos construindo.')).toEqual(['O que vamos ', 'construindo.']);
    expect(spreadText(['O que estamos ', 'construindo.'], 'O que estamos fazendo.')).toEqual(['O que estamos ', 'fazendo.']);
  });
  it('appends to the last piece and edits across a seam', () => {
    expect(spreadText(['Olá ', 'mundo'], 'Olá mundo!')).toEqual(['Olá ', 'mundo!']);
    expect(spreadText(['Olá ', 'mundo'], 'Oi')).toEqual(['Oi', '']);
  });
  it('collapses whitespace the way the field shows it', () => {
    expect(spreadText(['\n  Pagar\n  ', 'agora'], 'Pagar já')).toEqual([' Pagar ', 'já']);
  });
});
