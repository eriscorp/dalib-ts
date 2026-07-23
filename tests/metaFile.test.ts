import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { MetaFile } from '../src/data/MetaFile.js';
import { MetaFileEntry } from '../src/data/MetaFileEntry.js';

/**
 * Build a metadata container. All counts and lengths are big-endian:
 *   u16 groupCount, then per group u8 nameLen, name, u16 valueCount,
 *   then per value u16 len + bytes.
 */
function container(groups: Array<[string, string[]]>): Uint8Array {
  const parts: number[] = [];
  const pushU16 = (n: number) => parts.push((n >> 8) & 0xff, n & 0xff);
  const ascii = (s: string) => Array.from(new TextEncoder().encode(s));

  pushU16(groups.length);
  for (const [name, values] of groups) {
    const nb = ascii(name);
    parts.push(nb.length, ...nb);
    pushU16(values.length);
    for (const v of values) {
      const vb = ascii(v);
      pushU16(vb.length);
      parts.push(...vb);
    }
  }
  return new Uint8Array(parts);
}

describe('MetaFile', () => {
  const SAMPLE = container([
    ['Gobalt', ['bank.spf', 'shaman.spf']],
    ['Empty', []],
  ]);

  it('parses big-endian groups and values', () => {
    const meta = MetaFile.fromBuffer(SAMPLE);
    expect(meta.entries).toHaveLength(2);
    expect(meta.entries[0]!.key).toBe('Gobalt');
    expect(meta.entries[0]!.properties).toEqual(['bank.spf', 'shaman.spf']);
    expect(meta.entries[1]!.key).toBe('Empty');
    expect(meta.entries[1]!.properties).toEqual([]);
  });

  it('parses an empty container', () => {
    expect(MetaFile.fromBuffer(container([])).entries).toHaveLength(0);
  });

  it('accepts an ArrayBuffer', () => {
    const meta = MetaFile.fromBuffer(SAMPLE.buffer as ArrayBuffer);
    expect(meta.entries[0]!.key).toBe('Gobalt');
  });

  it('round-trips ASCII content byte for byte', () => {
    const out = MetaFile.fromBuffer(SAMPLE).toUint8Array();
    expect(Array.from(out)).toEqual(Array.from(SAMPLE));
  });

  it('inflates a zlib-compressed container', () => {
    const compressed = new Uint8Array(deflateSync(Buffer.from(SAMPLE)));
    const meta = MetaFile.fromCompressedBuffer(compressed);
    expect(meta.entries[0]!.properties).toEqual(['bank.spf', 'shaman.spf']);
  });

  it('inflates through the async path too', async () => {
    const compressed = new Uint8Array(deflateSync(Buffer.from(SAMPLE)));
    const meta = await MetaFile.fromCompressedBufferAsync(compressed);
    expect(meta.entries[0]!.key).toBe('Gobalt');
  });

  // TextEncoder only ever emits UTF-8, so there is no native EUC-KR encoder. Writing
  // non-ASCII as UTF-8 would produce both the wrong bytes and the wrong uint16 length
  // prefixes, yielding a file the client cannot parse. Failing loudly beats that.
  it('throws rather than writing non-ASCII as UTF-8', () => {
    const meta = new MetaFile();
    meta.entries.push(new MetaFileEntry('한글', ['x']));
    expect(() => meta.toUint8Array()).toThrow(/EUC-KR/);
  });

  it('throws when a property value is non-ASCII', () => {
    const meta = new MetaFile();
    meta.entries.push(new MetaFileEntry('ok', ['한글']));
    expect(() => meta.toUint8Array()).toThrow(/EUC-KR/);
  });

  it('writes a hand-built entry list', () => {
    const meta = new MetaFile();
    meta.entries.push(new MetaFileEntry('A', ['1', '22']));
    const reparsed = MetaFile.fromBuffer(meta.toUint8Array());
    expect(reparsed.entries[0]!.key).toBe('A');
    expect(reparsed.entries[0]!.properties).toEqual(['1', '22']);
  });
});

describe('MetaFileEntry', () => {
  it('defaults to no properties', () => {
    expect(new MetaFileEntry('k').properties).toEqual([]);
  });

  it('keeps the key and properties it was given', () => {
    const e = new MetaFileEntry('k', ['a', 'b']);
    expect(e.key).toBe('k');
    expect(e.properties).toEqual(['a', 'b']);
  });
});
