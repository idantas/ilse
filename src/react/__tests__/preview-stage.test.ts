import { describe, it, expect } from 'vitest';
import { parseExample, viteDepUrl } from '../preview-stage.js';

describe('preview stage', () => {
  it('draws what the usage example spells out: literal props and plain text', () => {
    expect(parseExample('<Button variant="outlined" size={2} disabled fullWidth={false}>Save</Button>', 'Button'))
      .toEqual({ props: { variant: 'outlined', size: 2, disabled: true, fullWidth: false }, text: 'Save' });
  });

  it('leaves expressions, handlers and styling out', () => {
    expect(parseExample('<Badge tone={kind} onClick={go} className="x" label={"Hi"} />', 'Badge'))
      .toEqual({ props: { label: 'Hi' } });
  });

  it('children that are JSX or expressions are not text', () => {
    expect(parseExample('<Card title="A"><p>x</p></Card>', 'Card')).toEqual({ props: { title: 'A' } });
    expect(parseExample('<Tag>{name}</Tag>', 'Tag')).toEqual({ props: {} });
  });

  it('an aliased import reads the first component tag', () => {
    expect(parseExample('<MuiButton variant="text">Go</MuiButton>', 'Button')).toEqual({ props: { variant: 'text' }, text: 'Go' });
  });

  it("finds the dependency URL the app loaded, so React stays the app's one", () => {
    const loaded = ['http://localhost:5173/node_modules/.vite/deps/react.js?v=1a', 'http://localhost:5173/node_modules/.vite/deps/@mui_material.js?v=1a'];
    expect(viteDepUrl('@mui/material', loaded)).toBe(loaded[1]);
    expect(viteDepUrl('@radix-ui/react-dialog', loaded)).toBeUndefined();
  });
});
