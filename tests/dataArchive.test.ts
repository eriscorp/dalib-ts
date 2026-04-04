import { describe, expect, it } from 'vitest';
import { DataArchive } from '../src/data/DataArchive.js';
import { SpanWriter } from '../src/io/SpanWriter.js';
import { DATA_ARCHIVE_ENTRY_NAME_LENGTH } from '../src/constants.js';

/** Build a minimal valid .dat buffer with the given entries. */
function buildDatBuffer(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const HEADER_LEN = 4;
  const ENTRY_HEADER_LEN = 4 + DATA_ARCHIVE_ENTRY_NAME_LENGTH; // 17

  let address = HEADER_LEN + files.length * ENTRY_HEADER_LEN + 4;
  const addresses: number[] = [];
  for (const f of files) {
    addresses.push(address);
    address += f.data.length;
  }

  const writer = new SpanWriter();
  writer.writeInt32LE(files.length + 1);

  for (let i = 0; i < files.length; i++) {
    writer.writeInt32LE(addresses[i]!);
    writer.writeFixedAscii(files[i]!.name, DATA_ARCHIVE_ENTRY_NAME_LENGTH);
  }

  writer.writeInt32LE(address); // final end address

  for (const f of files) {
    writer.writeBytes(f.data);
  }

  return writer.toUint8Array();
}

describe('DataArchive', () => {
  it('parses a minimal archive from buffer', () => {
    const dat = buildDatBuffer([
      { name: 'hello.spf', data: new Uint8Array([1, 2, 3]) },
      { name: 'world.pal', data: new Uint8Array([4, 5]) },
    ]);

    const archive = DataArchive.fromBuffer(dat);
    expect(archive.size).toBe(2);
    expect(archive.has('hello.spf')).toBe(true);
    expect(archive.has('HELLO.SPF')).toBe(true); // case-insensitive
    expect(archive.has('world.pal')).toBe(true);
    expect(archive.has('missing.dat')).toBe(false);
  });

  it('retrieves correct entry data', () => {
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const dat = buildDatBuffer([
      { name: 'test.hpf', data: payload },
    ]);

    const archive = DataArchive.fromBuffer(dat);
    const entry = archive.get('test.hpf')!;
    expect(entry).toBeDefined();
    expect(entry.fileSize).toBe(payload.length);
    expect(Array.from(entry.toUint8Array())).toEqual(Array.from(payload));
  });

  it('getEntriesByExtension filters correctly', () => {
    const dat = buildDatBuffer([
      { name: 'a.spf', data: new Uint8Array([1]) },
      { name: 'b.pal', data: new Uint8Array([2]) },
      { name: 'c.spf', data: new Uint8Array([3]) },
    ]);

    const archive = DataArchive.fromBuffer(dat);
    const spfEntries = archive.getEntriesByExtension('.spf');
    expect(spfEntries.length).toBe(2);
    expect(spfEntries.map(e => e.entryName)).toEqual(['a.spf', 'c.spf']);
  });

  it('getEntriesByPattern filters by prefix and extension', () => {
    const dat = buildDatBuffer([
      { name: 'stc00001.spf', data: new Uint8Array([1]) },
      { name: 'stc00002.spf', data: new Uint8Array([2]) },
      { name: 'other.spf', data: new Uint8Array([3]) },
    ]);

    const archive = DataArchive.fromBuffer(dat);
    const matches = archive.getEntriesByPattern('stc', '.spf');
    expect(matches.length).toBe(2);
  });

  it('round-trips through toUint8Array', () => {
    const files = [
      { name: 'test.hpf', data: new Uint8Array([0xca, 0xfe]) },
      { name: 'data.spf', data: new Uint8Array([0x01, 0x02, 0x03]) },
    ];
    const original = buildDatBuffer(files);
    const archive = DataArchive.fromBuffer(original);
    const serialized = archive.toUint8Array();

    // Re-parse the serialized archive and verify
    const reparsed = DataArchive.fromBuffer(serialized);
    expect(reparsed.size).toBe(2);
    expect(Array.from(reparsed.get('test.hpf')!.toUint8Array())).toEqual([0xca, 0xfe]);
    expect(Array.from(reparsed.get('data.spf')!.toUint8Array())).toEqual([0x01, 0x02, 0x03]);
  });

  it('tryGetNumericIdentifier parses number from entry name', () => {
    const dat = buildDatBuffer([
      { name: 'stc00012.spf', data: new Uint8Array([0]) },
    ]);
    const archive = DataArchive.fromBuffer(dat);
    const entry = archive.get('stc00012.spf')!;
    expect(entry.tryGetNumericIdentifier()).toBe(12);
  });

  it('tryGetNumericIdentifier returns null for non-numeric names', () => {
    const dat = buildDatBuffer([
      { name: 'nonum.pal', data: new Uint8Array([0]) },
    ]);
    const archive = DataArchive.fromBuffer(dat);
    const entry = archive.get('nonum.pal')!;
    expect(entry.tryGetNumericIdentifier()).toBeNull();
  });

  it('sort orders entries by prefix then numeric ID', () => {
    const dat = buildDatBuffer([
      { name: 'stc00010.spf', data: new Uint8Array([0]) },
      { name: 'stc00002.spf', data: new Uint8Array([0]) },
      { name: 'abc00001.spf', data: new Uint8Array([0]) },
    ]);
    const archive = DataArchive.fromBuffer(dat);
    archive.sort();

    const names = archive.entries.map(e => e.entryName);
    expect(names.indexOf('abc00001.spf')).toBeLessThan(names.indexOf('stc00002.spf'));
    expect(names.indexOf('stc00002.spf')).toBeLessThan(names.indexOf('stc00010.spf'));
  });
});
