import { describe, expect, it, vi } from 'vitest';
import { DataArchive } from '../src/data/DataArchive.js';
import type { DataArchiveWarning } from '../src/data/DataArchive.js';
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

  it('preserves duplicate entry names without throwing; first wins in lookup map', () => {
    const dat = buildDatBuffer([
      { name: 'dupe.spf', data: new Uint8Array([0xaa]) },
      { name: 'unique.spf', data: new Uint8Array([0xbb]) },
      { name: 'dupe.spf', data: new Uint8Array([0xcc]) },
    ]);

    const onWarning = vi.fn<(warning: DataArchiveWarning) => void>();
    const archive = DataArchive.fromBuffer(dat, { onWarning });

    expect(archive.size).toBe(3);
    expect(archive.entries.map(e => e.entryName)).toEqual(['dupe.spf', 'unique.spf', 'dupe.spf']);
    expect(Array.from(archive.get('dupe.spf')!.toUint8Array())).toEqual([0xaa]);
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledWith({
      kind: 'duplicate-entry-name',
      entryName: 'dupe.spf',
      index: 2,
    });
  });

  it('parses archives containing an empty entry name without throwing', () => {
    const dat = buildDatBuffer([
      { name: '', data: new Uint8Array([0x99]) },
      { name: 'real.spf', data: new Uint8Array([0x77]) },
    ]);

    const onWarning = vi.fn<(warning: DataArchiveWarning) => void>();
    const archive = DataArchive.fromBuffer(dat, { onWarning });

    expect(archive.size).toBe(2);
    expect(archive.has('real.spf')).toBe(true);
    expect(onWarning).toHaveBeenCalledWith({
      kind: 'empty-entry-name',
      entryName: '',
      index: 0,
    });
  });

  it('still accepts the legacy positional newFormat boolean', () => {
    const dat = buildDatBuffer([
      { name: 'plain.spf', data: new Uint8Array([0x01]) },
    ]);
    const archive = DataArchive.fromBuffer(dat, false);
    expect(archive.size).toBe(1);
    expect(archive.has('plain.spf')).toBe(true);
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

  describe('sort', () => {
    const sortedNames = (files: string[]): string[] => {
      const archive = DataArchive.fromBuffer(
        buildDatBuffer(files.map(name => ({ name, data: new Uint8Array([0]) }))),
      );
      archive.sort();
      return archive.entries.map(e => e.entryName);
    };

    it('puts an underscore-prefixed name first', () => {
      // The client's UI assets are underscore-prefixed and load ahead of the rest.
      const names = sortedNames(['stc001.spf', '_nbtn.spf', 'abc001.spf']);
      expect(names[0]).toBe('_nbtn.spf');
    });

    it('sorts a bare numeric name as its own prefix group', () => {
      const names = sortedNames(['0002.hea', '0010.hea', '0001.hea']);
      expect(names).toEqual(['0001.hea', '0002.hea', '0010.hea']);
    });

    // Within one prefix the common id width decides where the number ends; a
    // longer run of digits spills into the tail and sorts after the plain ids.
    it('treats digits beyond the common id width as a tail', () => {
      const names = sortedNames(['stc001.spf', 'stc002.spf', 'stc0011.spf']);
      expect(names.indexOf('stc001.spf')).toBeLessThan(names.indexOf('stc002.spf'));
      expect(names).toContain('stc0011.spf');
    });

    it('breaks a numeric tie on the tail, then on the extension', () => {
      const names = sortedNames(['stc001a.spf', 'stc001b.spf', 'stc001a.hpf']);
      expect(names.indexOf('stc001a.hpf')).toBeLessThan(names.indexOf('stc001a.spf'));
      expect(names.indexOf('stc001a.spf')).toBeLessThan(names.indexOf('stc001b.spf'));
    });

    it('keeps a name with no numeric part ahead of the numbered ones', () => {
      const names = sortedNames(['stc001.spf', 'stc.spf']);
      expect(names[0]).toBe('stc.spf');
    });

    it('handles a name with no extension', () => {
      const names = sortedNames(['readme', 'stc001.spf']);
      expect(names).toHaveLength(2);
      expect(names).toContain('readme');
    });
  });

  describe('DataArchiveEntry', () => {
    it('copies the entry bytes into a standalone ArrayBuffer', () => {
      const archive = DataArchive.fromBuffer(
        buildDatBuffer([{ name: 'a.pal', data: new Uint8Array([1, 2, 3, 4]) }]),
      );
      const entry = archive.get('a.pal')!;

      const copied = entry.toArrayBuffer();
      expect(copied.byteLength).toBe(4);
      expect(Array.from(new Uint8Array(copied))).toEqual([1, 2, 3, 4]);
      // The copy must not be a view onto the archive buffer.
      new Uint8Array(copied)[0] = 99;
      expect(entry.toUint8Array()[0]).toBe(1);
    });

    it('parses a numeric identifier, honouring a digit limit', () => {
      const archive = DataArchive.fromBuffer(
        buildDatBuffer([
          { name: 'stc00012.spf', data: new Uint8Array([0]) },
          { name: 'plain.spf', data: new Uint8Array([0]) },
        ]),
      );

      expect(archive.get('stc00012.spf')!.tryGetNumericIdentifier()).toBe(12);
      expect(archive.get('stc00012.spf')!.tryGetNumericIdentifier(3)).toBe(0);
      expect(archive.get('plain.spf')!.tryGetNumericIdentifier()).toBeNull();
    });
  });
});
