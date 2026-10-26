import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePropEdit, planPropSwap, writeProp, type PropEdit } from '../prop-swap.js';

function project(files: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ilse-prop-'));
  for (const [path, code] of Object.entries(files)) {
    mkdirSync(join(cwd, path, '..'), { recursive: true });
    writeFileSync(join(cwd, path), code);
  }
  return cwd;
}

const HEADER = `import { Box, Button as MuiButton } from '@mui/material';
export function Header() {
  return (
    <Box>
      <MuiButton variant="contained">Save</MuiButton>
      <MuiButton variant="outlined" size="small">Cancel</MuiButton>
      <MuiButton variant={kind}>Dynamic</MuiButton>
    </Box>
  );
}`;

const cwd = project({
  'src/header.tsx': HEADER,
  'src/components/ui/button.tsx': 'export function Button(p: { variant?: "a" | "b" }) { return <button /> }',
  'src/page.tsx': `import { Button } from './components/ui/button';\nexport const P = () => <div><Button>Go</Button><Button variant="a">Go</Button></div>;`,
});
const url = (file: string) => `http://localhost:5173/${file}?t=1`;
const mui = (over: Partial<PropEdit>): PropEdit => ({
  component: 'Button', source: '@mui/material', frameUrl: url('src/header.tsx'), props: {}, changes: [], ...over,
});

describe('prop swap', () => {
  it('rewrites the literal prop of the one matching <Button>, aliased import and all', () => {
    const res = planPropSwap(mui({ props: { variant: 'contained' }, text: 'Save', changes: [{ prop: 'variant', from: 'contained', to: 'outlined' }] }), cwd);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.after).toContain('<MuiButton variant="outlined">Save</MuiButton>');
    expect(res.plan.after).toContain('<MuiButton variant="outlined" size="small">Cancel</MuiButton>');
    expect(res.plan.line).toBe(5);
  });

  it('adds a prop the JSX did not set, booleans as JSX writes them', () => {
    const res = planPropSwap(mui({ props: { variant: 'outlined', size: 'small' }, text: 'Cancel', changes: [{ prop: 'disabled', to: 'true' }, { prop: 'size', from: 'small', to: 'large' }] }), cwd);
    expect(res.ok && res.plan.after).toContain('<MuiButton disabled variant="outlined" size="large">Cancel</MuiButton>');
  });

  it('back to the default: the prop leaves the JSX, its own line too', () => {
    const inline = planPropSwap(mui({ props: { variant: 'outlined', size: 'small' }, text: 'Cancel', changes: [{ prop: 'size', from: 'small', to: '' }] }), cwd);
    expect(inline.ok && inline.plan.after).toContain('<MuiButton variant="outlined">Cancel</MuiButton>');
    const multi = project({
      'src/screen.tsx': `import { Dialog } from './dialog';\nexport const S = () => (\n  <Dialog\n    open\n    teamFixed\n    onClose={close}\n  />\n);`,
      'src/dialog.tsx': 'export function Dialog(p: { teamFixed?: boolean }) { return <div /> }',
    });
    const res = planPropSwap({ component: 'Dialog', source: 'src/dialog.tsx', frameUrl: url('src/screen.tsx'), props: { open: true, teamFixed: true }, changes: [{ prop: 'teamFixed', from: 'true', to: '' }] }, multi);
    expect(res.ok && res.plan.after).toContain('  <Dialog\n    open\n    onClose={close}\n  />');
  });

  it('a prop set by an expression, or two lookalikes, go to the agent', () => {
    const dyn = planPropSwap(mui({ props: { variant: 'text' }, text: 'Dynamic', changes: [{ prop: 'variant', to: 'outlined' }] }), cwd);
    expect(dyn).toEqual({ ok: false, reason: 'variant vem de uma expressão' });
    const none = planPropSwap(mui({ props: { variant: 'text' }, text: 'Nope', changes: [{ prop: 'variant', to: 'outlined' }] }), cwd);
    expect(none.ok).toBe(false);
    const noFile = planPropSwap(mui({ frameUrl: undefined, changes: [{ prop: 'variant', to: 'x' }] }), cwd);
    expect(noFile.ok).toBe(false);
  });

  it('project components, told apart by their literal props', () => {
    const edit: PropEdit = { component: 'Button', source: 'src/components/ui/button.tsx', frameUrl: url('src/page.tsx'), props: {}, text: 'Go', changes: [{ prop: 'variant', to: 'b' }] };
    const res = planPropSwap(edit, cwd);
    expect(res.ok && res.plan.after).toContain('<div><Button variant="b">Go</Button><Button variant="a">Go</Button></div>');
  });

  it('writes values the way JSX does', () => {
    expect(writeProp('size', 'small')).toBe('size="small"');
    expect(writeProp('elevation', '2', true)).toBe('elevation={2}');
    expect(writeProp('disabled', 'true')).toBe('disabled');
    expect(writeProp('disabled', 'false')).toBe('disabled={false}');
    expect(writeProp('label', 'say "hi"')).toBe('label={"say \\"hi\\""}');
  });

  it('parses only the shapes the toolbar sends', () => {
    expect(parsePropEdit({ component: 'Button', source: 'x', changes: [] })).toBeUndefined();
    expect(parsePropEdit({ component: 'Button', source: 'x', props: { a: 'b', f: () => 1, n: 2 }, changes: [{ prop: 'v', to: 'a' }] }))
      .toEqual({ component: 'Button', source: 'x', props: { a: 'b', n: 2 }, changes: [{ prop: 'v', to: 'a' }] });
  });
});
