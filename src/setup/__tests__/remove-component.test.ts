import { describe, it, expect } from 'vitest';
import { removeIlseComponent } from '../remove-component.js';

const NEXT_LAYOUT = `import './globals.css';
import { Ilse } from "ilse-design/react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Ilse />
      </body>
    </html>
  );
}
`;

const CLEAN = `import './globals.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
`;

describe('removeIlseComponent', () => {
  it('takes out the import and the tag an older Ilse wrote', () => {
    const r = removeIlseComponent(NEXT_LAYOUT, 'app/layout.tsx');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content).toBe(CLEAN);
    expect(r.removed).toEqual(['import { Ilse } from "ilse-design/react";', '<Ilse />']);
  });

  it('removes a guarded line and a tag with props', () => {
    const src = NEXT_LAYOUT.replace('<Ilse />', "{process.env.NODE_ENV === 'development' && <Ilse lang=\"pt\" />}");
    const r = removeIlseComponent(src, 'app/layout.tsx');
    expect(r.ok && r.content).toBe(CLEAN);
  });

  it('removes a tag written inline next to other JSX', () => {
    const src = `import { Ilse } from 'ilse-design/react';\nexport const App = () => <main><Page /><Ilse /></main>;\n`;
    const r = removeIlseComponent(src, 'src/App.tsx');
    expect(r.ok && r.content).toBe('export const App = () => <main><Page /></main>;\n');
  });

  it('says not-found when there is nothing of Ilse', () => {
    expect(removeIlseComponent(CLEAN, 'app/layout.tsx')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('refuses when Ilse is still used in a way it does not recognise', () => {
    const src = NEXT_LAYOUT.replace('<Ilse />', '<Ilse>{x}</Ilse>');
    expect(removeIlseComponent(src, 'app/layout.tsx')).toEqual({ ok: false, reason: 'still-used' });
  });
});
