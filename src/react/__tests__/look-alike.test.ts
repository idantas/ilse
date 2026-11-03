import { describe, expect, it } from 'vitest';
import { groupLookAlikes, lookId, looseFamilies, pieceKind, type Look, type LookMember } from '../look-alike.js';

const orange = { r: 255, g: 108, b: 3, a: 1 };
const black = { r: 0, g: 0, b: 0, a: 1 };
const ink = { r: 10, g: 10, b: 10, a: 1 };
const line = { r: 233, g: 233, b: 233, a: 1 };

const button = (over: Partial<Look> = {}): Look => ({
  radius: 8, padX: 16, padY: 10, height: 40, fontSize: 13, fontWeight: 500, textTransform: 'none',
  fill: orange, text: black, border: { width: 0, color: black }, shadow: false, ...over,
});
const outline: Partial<Look> = { fill: { r: 0, g: 0, b: 0, a: 0 }, text: ink, border: { width: 1, color: line } };
const m = (look: Look, ref: string, file?: string): LookMember<string> => ({ look, ref, file });

describe('look-alikes', () => {
  it('the same shape is one family; its paints are variants, the most used first', () => {
    const [f, ...rest] = groupLookAlikes([
      m(button(), 'a'), m(button(outline), 'b'), m(button(), 'c'), m(button({ fill: { ...orange, g: 109 } }), 'd'),
    ]);
    expect(rest).toEqual([]);
    expect(f.variants.map(v => v.members.map(x => x.ref))).toEqual([['a', 'c', 'd'], ['b']]);
  });

  it('rounding noise is not a different piece', () => {
    const [f] = groupLookAlikes([m(button(), 'a'), m(button({ padX: 15.5, height: 39 }), 'b'), m(button({ fontWeight: 550 }), 'c')]);
    expect(f.size).toBe(3);
  });

  it('one shape property off joins the bigger family as a near miss, saying what differs', () => {
    const [f, ...rest] = groupLookAlikes([
      m(button(), 'a'), m(button(outline), 'b'), m(button(), 'c'), m(button({ padX: 12 }), 'nav'),
    ]);
    expect(rest).toEqual([]);
    expect(f.size).toBe(3);
    expect(f.nearMisses).toEqual([{ member: expect.objectContaining({ ref: 'nav' }), differsIn: 'padX' }]);
  });

  it('two properties off is another piece', () => {
    const groups = groupLookAlikes([
      m(button(), 'a'), m(button(), 'b'), m(button(), 'c'),
      m(button({ radius: 999, height: 24, padX: 8 }), 'chip'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].nearMisses).toEqual([]);
  });

  it('shows a pattern only: 3 members, or 2 written in different files', () => {
    expect(groupLookAlikes([m(button(), 'a'), m(button(), 'b')])).toEqual([]);
    expect(groupLookAlikes([m(button(), 'a', 'x.tsx'), m(button(), 'b', 'x.tsx')])).toEqual([]);
    expect(groupLookAlikes([m(button(), 'a', 'x.tsx'), m(button(), 'b', 'y.tsx')])).toHaveLength(1);
  });

  it('a pill is a pill whatever its radius', () => {
    const [f] = groupLookAlikes([m(button({ radius: 20 }), 'a'), m(button({ radius: 9999 }), 'b'), m(button({ radius: 999 }), 'c')]);
    expect(f.size).toBe(3);
    expect(f.shape).toContain('radius=pill');
  });

  it('members that are all one component\'s roots are that component, not look-alikes', () => {
    const made = (c?: string) => (x: LookMember<string>) => ({ ...x, component: c });
    const same = groupLookAlikes([m(button(), 'a'), m(button(), 'b'), m(button(), 'c')].map(made('Button')));
    expect(looseFamilies(same)).toEqual([]);
    const mixed = groupLookAlikes([made('Button')(m(button(), 'a')), m(button(), 'b'), m(button(), 'c')]);
    expect(looseFamilies(mixed)).toHaveLength(1);
    // A hand-written piece one property off doesn't undo the component
    const nearby = groupLookAlikes([...[m(button(), 'a'), m(button(), 'b'), m(button(), 'c')].map(made('Button')), m(button({ padY: 4 }), 'd')]);
    expect(nearby[0].nearMisses).toHaveLength(1);
    expect(looseFamilies(nearby)).toEqual([]);
  });

  it('names the piece by its most common element', () => {
    expect(pieceKind(['A', 'BUTTON', 'SPAN'])).toBe('button');
    expect(pieceKind(['INPUT', 'SELECT'])).toBe('field');
    expect(pieceKind(['SPAN', 'SPAN', 'A'])).toBe('chip');
  });

  it('an ignored look keeps its id whatever its words do to its height', () => {
    expect(lookId('button', 'radius=pill padX=16 height=56 textTransform=')).toBe(lookId('button', 'radius=pill padX=16 height=40 textTransform='));
    expect(lookId('button', 'radius=pill padX=16 height=40')).toBe('button:radius=pill padX=16');
  });
});
