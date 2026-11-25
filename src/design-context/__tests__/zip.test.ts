import { describe, expect, it } from 'vitest';
import { crc32, zipStore } from '../zip.js';

describe('zipStore', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(Buffer.from('hello'))).toBe(0x3610a686);
  });

  it('writes every file with its name, size and a central directory', () => {
    const files = [{ path: 'ds/README.md', data: Buffer.from('# DS\n') }, { path: 'ds/components/forms.md', data: Buffer.from('ação') }];
    const zip = zipStore(files);
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50);
    expect(zip.readUInt16LE(end + 10)).toBe(2);
    let at = zip.readUInt32LE(end + 16);
    const names: string[] = [];
    for (let i = 0; i < 2; i++) {
      expect(zip.readUInt32LE(at)).toBe(0x02014b50);
      const len = zip.readUInt16LE(at + 28);
      const offset = zip.readUInt32LE(at + 42);
      const size = zip.readUInt32LE(at + 24);
      names.push(zip.subarray(at + 46, at + 46 + len).toString('utf8'));
      const nameLen = zip.readUInt16LE(offset + 26);
      expect(zip.subarray(offset + 30 + nameLen, offset + 30 + nameLen + size)).toEqual(files[i].data);
      at += 46 + len;
    }
    expect(names).toEqual(['ds/README.md', 'ds/components/forms.md']);
  });
});
