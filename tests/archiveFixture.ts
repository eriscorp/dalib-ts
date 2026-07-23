import { DATA_ARCHIVE_ENTRY_NAME_LENGTH } from '../src/constants.js';
import { DataArchive } from '../src/data/DataArchive.js';
import { SpanWriter } from '../src/io/SpanWriter.js';

/** One file to place in a synthetic archive. */
export interface ArchiveFile {
  name: string;
  data: Uint8Array;
}

/**
 * Build a minimal valid .dat buffer that holds the supplied entries.
 *
 * Layout: an int32 entry count (one more than the file count, because the
 * terminator record counts), then one (address, 13-byte name) record per file,
 * then the end-of-data address, then the file bodies.
 */
export function buildArchiveBytes(files: ArchiveFile[]): Uint8Array {
  const ENTRY_HEADER_LEN = 4 + DATA_ARCHIVE_ENTRY_NAME_LENGTH;
  let address = 4 + files.length * ENTRY_HEADER_LEN + 4;
  const addresses = files.map(f => {
    const a = address;
    address += f.data.length;
    return a;
  });

  const writer = new SpanWriter();
  writer.writeInt32LE(files.length + 1);
  files.forEach((f, i) => {
    writer.writeInt32LE(addresses[i]!);
    writer.writeFixedAscii(f.name, DATA_ARCHIVE_ENTRY_NAME_LENGTH);
  });
  writer.writeInt32LE(address);
  files.forEach(f => writer.writeBytes(f.data));

  return writer.toUint8Array();
}

/** Build a {@link DataArchive} that holds the supplied entries. */
export function buildArchive(files: ArchiveFile[]): DataArchive {
  return DataArchive.fromBuffer(buildArchiveBytes(files));
}
