import { describe, it, expect } from 'vitest';
import { formatComponentAsk } from '../augment.js';

describe('formatComponentAsk', () => {
  it('says what counts as a component when the note asks for one (live: KpiCard left inside the page)', () => {
    const block = formatComponentAsk('transforme esse card em component com duas variantes', 'src/components');
    expect(block).toContain('`src/components/`');
    expect(block).toContain('exported');
    expect(block).toContain('Import it');
    expect(formatComponentAsk('Make these a component with a size variant', 'components')).toContain('`components/`');
  });

  it('stays out of other notes', () => {
    expect(formatComponentAsk('deixa o fundo verde', 'src/components')).toBeUndefined();
    expect(formatComponentAsk(undefined, 'src/components')).toBeUndefined();
  });
});
