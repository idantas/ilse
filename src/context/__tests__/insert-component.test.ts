import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Annotation } from '../../types.js';
import { buildJsx, parseInsert, planInsert, type InsertRequest } from '../insert-component.js';

function project(files: Record<string, string>): string {
  const cwd = mkdtempSync(join(tmpdir(), 'ilse-ins-'));
  for (const [path, code] of Object.entries(files)) {
    mkdirSync(join(cwd, path, '..'), { recursive: true });
    writeFileSync(join(cwd, path), code);
  }
  return cwd;
}

const SEARCH = `import { Box, TextField } from '@mui/material';
export function Search() {
  return (
    <Box sx={{ display: 'flex' }}>
      <TextField label="Nome" size="small" />
    </Box>
  );
}`;
const LIST = `export function List({ rows }) {
  return <ul>{rows.map(r => <li key={r}>{r}</li>)}</ul>;
}`;

const cwd = project({
  'src/search.tsx': SEARCH,
  'src/list.tsx': LIST,
  'src/components/ui/button.tsx': 'export function Button(p: { variant?: "a" | "b" }) { return <button /> }',
});

const muiButton = (over: Partial<InsertRequest> = {}): InsertRequest => ({
  component: 'Button', source: '@mui/material', module: '@mui/material', importAs: 'named', library: true,
  placement: 'after', props: {}, required: [], example: '<Button variant="outlined">Buscar</Button>', ...over,
});
const ann = (file: string, line: number, element: string, insert: InsertRequest) => ({
  id: 'a', element, insert, source: [{ kind: 'element', file, line, score: 10 }],
}) as unknown as Annotation;

describe('insert a catalog component', () => {
  it('after the anchor, copying the usual props and text, into the existing import', () => {
    const res = planInsert(ann('src/search.tsx', 5, 'div.MuiTextField-root', muiButton({ props: { variant: 'contained' } })), cwd);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.after).toContain(`import { Box, TextField, Button } from '@mui/material';`);
    expect(res.plan.after).toContain(`      <TextField label="Nome" size="small" />\n      <Button variant="contained">Buscar</Button>\n    </Box>`);
  });

  it('inside a container, before its closing tag, with a new import for a project component', () => {
    const req: InsertRequest = { component: 'Button', source: 'src/components/ui/button.tsx', importAs: 'named', library: false, placement: 'inside', props: { variant: 'b' }, required: [], text: 'Salvar' };
    const res = planInsert(ann('src/search.tsx', 4, 'div', req), cwd);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.after).toContain(`import { Button } from './components/ui/button';`);
    expect(res.plan.after).toContain(`      <TextField label="Nome" size="small" />\n      <Button variant="b">Salvar</Button>\n    </Box>`);
  });

  it('a list item, a missing required prop or a handler to wire go to the agent', () => {
    expect(planInsert(ann('src/list.tsx', 2, 'li', muiButton()), cwd)).toEqual({ ok: false, reason: 'dentro de uma lista' });
    expect(planInsert(ann('src/search.tsx', 5, 'div', muiButton({ required: ['href'] })), cwd)).toEqual({ ok: false, reason: 'sem valor para href' });
    expect(buildJsx(muiButton({ example: '<Button onClick={save}>Go</Button>', required: ['onClick'] }), 'Button')).toEqual({ reason: 'onClick precisa ser ligado' });
  });

  it('builds the JSX from the example, the picks on top', () => {
    expect(buildJsx(muiButton({ example: '<Button variant="outlined" onClick={go} disabled>Go</Button>', props: { size: 'small' } }), 'Btn'))
      .toEqual({ code: '<Btn variant="outlined" disabled size="small">Go</Btn>' });
    expect(buildJsx(muiButton({ example: undefined, text: undefined }), 'Button')).toEqual({ code: '<Button />' });
    expect(buildJsx(muiButton({ example: '<Button>{label}</Button>' }), 'Button')).toEqual({ reason: 'o conteúdo do exemplo vem de código' });
  });

  it('parses only the shapes the toolbar sends', () => {
    expect(parseInsert({ component: 'button', source: 'x', placement: 'after' })).toBeUndefined();
    expect(parseInsert({ component: 'Button', source: 'x', placement: 'over' })).toBeUndefined();
    expect(parseInsert({ component: 'Button', source: 'x', placement: 'after', props: { 'bad key': 1, size: 'sm' } }))
      .toMatchObject({ component: 'Button', placement: 'after', props: { size: 'sm' }, importAs: 'named', library: false, required: [] });
  });
});

describe('insert next to a component instance', () => {
  const cwd2 = project({
    'src/app.tsx': `import { StatCard } from './stat-card';
export function App() {
  return (
    <div>
      <StatCard label="A" value="1" />
      <StatCard label="B" value="2" />
    </div>
  );
}`,
    'src/stat-card.tsx': 'export function StatCard(p: { label: string; value: string }) { return <div className="card">{p.label}</div> }',
  });
  it('goes where the page wrote that instance, not into its definition', () => {
    const req: InsertRequest = {
      component: 'Chip', source: '@mui/material', module: '@mui/material', importAs: 'named', library: true, placement: 'after',
      props: { size: 'small' }, required: [], text: 'Novo',
      at: { component: 'StatCard', frameUrl: 'http://localhost:5173/src/app.tsx', props: { label: 'B', value: '2' } },
    };
    const res = planInsert({ id: 'x', element: 'div.card', insert: req, source: [{ kind: 'element', file: 'src/stat-card.tsx', line: 1, score: 10 }] } as unknown as Annotation, cwd2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.plan.file).toBe('src/app.tsx');
    expect(res.plan.after).toContain(`      <StatCard label="B" value="2" />\n      <Chip size="small">Novo</Chip>\n    </div>`);
    expect(res.plan.after).toContain(`import { Chip } from '@mui/material';`);
  });
});
