import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// The extension is plain JavaScript loaded unpacked by Chrome (extension/)
import { BRIDGE_PORTS, isLocalPage, originOf, toggleOrigin, fetchToolbar } from '../../../extension/lib.js';

const EXT = join(__dirname, '..', '..', '..', 'extension');

describe('extension lib', () => {
  it('only treats pages on this machine as local', () => {
    expect(isLocalPage('http://localhost:5173/login')).toBe(true);
    expect(isLocalPage('http://127.0.0.1:3000/')).toBe(true);
    expect(isLocalPage('https://localhost:5173/')).toBe(true);
    expect(isLocalPage('https://example.com/')).toBe(false);
    expect(isLocalPage('http://localhost.evil.com/')).toBe(false);
    expect(isLocalPage('chrome://extensions/')).toBe(false);
    expect(isLocalPage(undefined)).toBe(false);
  });

  it('keeps the choice per origin', () => {
    expect(originOf('http://localhost:5173/a/b?c')).toBe('http://localhost:5173');
    const on = toggleOrigin(['http://localhost:3000'], 'http://localhost:5173');
    expect(on).toEqual(['http://localhost:3000', 'http://localhost:5173']);
    expect(toggleOrigin(on, 'http://localhost:5173')).toEqual(['http://localhost:3000']);
  });

  it('scans the same ports as the toolbar', () => {
    expect(BRIDGE_PORTS[0]).toBe(4747);
    expect(BRIDGE_PORTS.at(-1)).toBe(4757);
  });

  it('takes the toolbar from the first ilse that answers', async () => {
    const asked: string[] = [];
    const fake = async (url: string) => {
      asked.push(url);
      if (url.includes(':4747/')) throw new TypeError('connection refused');
      if (url.includes(':4748/')) return new Response('nope', { status: 426 });
      return new Response('/* toolbar */', { status: 200 });
    };
    expect(await fetchToolbar(fake)).toBe('/* toolbar */');
    expect(asked).toEqual([
      'http://127.0.0.1:4747/__ilse/toolbar.js',
      'http://127.0.0.1:4748/__ilse/toolbar.js',
      'http://127.0.0.1:4749/__ilse/toolbar.js',
    ]);
  });

  it('is null when no ilse is running', async () => {
    expect(await fetchToolbar(async () => { throw new TypeError('refused'); })).toBeNull();
  });
});

describe('extension manifest', () => {
  const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
  const en = JSON.parse(readFileSync(join(EXT, '_locales', 'en', 'messages.json'), 'utf8'));
  const pt = JSON.parse(readFileSync(join(EXT, '_locales', 'pt_BR', 'messages.json'), 'utf8'));
  const background = readFileSync(join(EXT, 'background.js'), 'utf8');

  it('is MV3 and points at files that exist', () => {
    expect(manifest.manifest_version).toBe(3);
    expect(existsSync(join(EXT, manifest.background.service_worker))).toBe(true);
    for (const icon of Object.values({ ...manifest.icons, ...manifest.action.default_icon })) {
      expect(existsSync(join(EXT, icon as string))).toBe(true);
    }
  });

  it('only asks for localhost', () => {
    expect(manifest.host_permissions).toEqual(['http://localhost/*', 'http://127.0.0.1/*']);
    // contextMenus: the right-click items; Chrome shows no install warning for it
    expect(manifest.permissions).toEqual(['storage', 'scripting', 'contextMenus']);
    expect(manifest.content_scripts.flatMap((c: { matches: string[] }) => c.matches)).toEqual(['http://localhost/*', 'http://127.0.0.1/*']);
  });

  it('has every message in English and Portuguese', () => {
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
    const used = [
      ...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g),
      ...background.matchAll(/getMessage\((?:on \? )?'(\w+)'(?: : '(\w+)')?\)/g),
    ].flatMap((m) => m.slice(1).filter(Boolean));
    expect(used.length).toBeGreaterThan(4);
    for (const key of used) expect(en, key).toHaveProperty(key);
  });
});

describe('right-click menu', () => {
  it('one item, on local pages only, that selects the element', async () => {
    const { menuItems, menuAction } = await import('../../../extension/lib.js');
    const items = menuItems((k: string) => `«${k}»`);
    expect(items.map((i: { id: string; title: string }) => [i.id, i.title])).toEqual([['ilse-select', '«menuOpen»']]);
    expect(items[0].documentUrlPatterns).toEqual(['http://localhost/*', 'http://127.0.0.1/*']);
    expect([menuAction('ilse-select'), menuAction('x')]).toEqual(['select', null]);
  });
  it('the manifest asks for the menu and marks the right-clicked element', () => {
    const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
    expect(manifest.permissions).toContain('contextMenus');
    expect(manifest.content_scripts[0].js).toEqual(['context.js']);
    expect(existsSync(join(EXT, 'context.js'))).toBe(true);
  });
});
