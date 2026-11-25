import { describe, it, expect } from 'vitest';
import { creatorUrl, isPackageUrl, packageOfUrl, pickByOrigin } from '../component-origin.js';

const local = { name: 'Badge', source: 'web/src/components/badge.tsx', library: false };
const ds = { name: 'Badge', source: '@idantas/ui', library: true };
const other = { name: 'Badge', source: 'web/src/admin/badge.tsx', library: false };

describe('component origin', () => {
  it('reads where the JSX ran, skipping React\'s own frames', () => {
    const stack = [
      'Error: react-stack-top-frame',
      '    at exports.jsxDEV (http://localhost:3010/_next/static/chunks/node_modules_next_dist_compiled_react_jsx-dev-runtime.js:10:5)',
      '    at Badge (http://localhost:3010/_next/static/chunks/src_components_badge_tsx_1a2b.js:12:3)',
      '    at Message (http://localhost:3010/_next/static/chunks/src_app_page_tsx.js:40:9)',
    ].join('\n');
    expect(creatorUrl(stack)).toBe('http://localhost:3010/_next/static/chunks/src_components_badge_tsx_1a2b.js');
    expect(creatorUrl('    at http://localhost:5173/node_modules/.vite/deps/@acme_ui.js?v=1:3:4')).toBe('http://localhost:5173/node_modules/.vite/deps/@acme_ui.js?v=1');
    expect(creatorUrl(undefined)).toBeUndefined();
  });

  it('knows a package\'s file in webpack, Vite and Turbopack', () => {
    expect(isPackageUrl('webpack-internal:///(app-pages-browser)/../node_modules/@idantas/ui/dist/index.mjs')).toBe(true);
    expect(isPackageUrl('http://x/_next/static/chunks/node_modules_@idantas_ui_dist_index_mjs_9f.js')).toBe(true);
    expect(isPackageUrl('http://x/_next/static/chunks/src_components_badge_tsx.js')).toBe(false);
    expect(packageOfUrl('webpack-internal:///../node_modules/@idantas/ui/dist/index.mjs')).toBe('@idantas/ui');
  });

  it('same name, different places: picks by where it was written', () => {
    expect(pickByOrigin([local, ds], 'http://x/_next/static/chunks/src_components_badge_tsx_1a.js')).toBe(local);
    expect(pickByOrigin([local, ds], 'http://x/_next/static/chunks/node_modules_@idantas_ui_dist_index_mjs.js')).toBe(ds);
    // Two project Badges: the file in the url decides
    expect(pickByOrigin([local, other], 'webpack-internal:///./web/src/admin/badge.tsx')).toBe(other);
  });

  it('never guesses: no stack, or nothing matches, is no component', () => {
    expect(pickByOrigin([local, ds], undefined)).toBeNull();
    expect(pickByOrigin([local, other], 'http://x/chunks/src_app_page_tsx.js')).toBeNull();
    // One candidate needs no proof
    expect(pickByOrigin([ds], undefined)).toBe(ds);
  });
});
