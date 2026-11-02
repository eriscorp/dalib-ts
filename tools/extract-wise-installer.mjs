#!/usr/bin/env node
/**
 * Extract the files out of a Wise Installation Wizard self-extracting installer,
 * without running it. Written for the Dark Ages 7.41 client installer
 * (`DarkAges741single.exe`), whose `.dat` archives are what the client-asset
 * suites in `tests/` read.
 *
 * Usage:
 *   node tools/extract-wise-installer.mjs <installer.exe> <outDir> [options]
 *
 *   --lowercase   write every name lowercased (the client is case-insensitive on
 *                 Windows; ext4 is not, and the suites look up `legend.dat`)
 *   --dry-run     verify every record and print the manifest, write nothing
 *   --force       allow writing into a non-empty output directory
 *
 * ## Format
 *
 * A Wise installer is a small PE stub with its payload appended after the last
 * section. The payload is a run of raw-deflate streams (no zlib header), each
 * followed by a 4-byte little-endian CRC32 of its own *inflated* bytes.
 *
 * The second stream is the Wise script. Inside it, each installed file is a
 * record laid out, reading backwards from its NUL-terminated `%VAR%\path`:
 *
 *   u32 start · u32 end · u32 wiseCrc · u32 size · 20 NUL bytes · 4 bytes · path\0
 *
 * `start`/`end` are relative to the start of the payload data area, which sits
 * after the stub's own streams; `end` includes the 4-byte CRC trailer, and the
 * records are contiguous (one record's `end` is the next one's `start`). The
 * base is *derived* rather than hardcoded, by walking the stub's streams until
 * two consecutive ones match the first two records' sizes.
 *
 * `wiseCrc` is Wise's own checksum variant and is not a CRC32 — it is read for
 * completeness and never checked. The trailer is a standard CRC32 and is what
 * every extracted file is verified against, alongside its exact recorded size.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync, constants } from 'node:zlib';

/** Largest window fed to a tolerant inflate while walking the stub's streams. */
const WALK_WINDOW = 16 * 1024 * 1024;
/** Give up rather than walk the whole payload looking for the data base. */
const MAX_WALK_STREAMS = 64;
/** How far into the overlay to look for the very first deflate stream. */
const FIRST_STREAM_SCAN = 4096;
/**
 * Ignore tiny "successes" while scanning. Raw deflate has no header to check,
 * so most offsets in the Wise header inflate to a byte or two of garbage before
 * failing; the real first stream is a bitmap, thousands of bytes long.
 */
const MIN_STREAM_BYTES = 256;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Offset of the appended payload: the end of the last PE section's raw data. */
function overlayStart(buf) {
  if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error('not a PE file (no MZ signature)');
  const peOff = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(peOff) !== 0x00004550) throw new Error('not a PE file (no PE signature)');
  const sections = buf.readUInt16LE(peOff + 6);
  const optSize = buf.readUInt16LE(peOff + 20);
  const table = peOff + 24 + optSize;
  let end = 0;
  for (let i = 0; i < sections; i++) {
    const row = table + i * 40;
    end = Math.max(end, buf.readUInt32LE(row + 16) + buf.readUInt32LE(row + 20));
  }
  if (end <= 0 || end >= buf.length) throw new Error('no overlay after the PE sections');
  return end;
}

/**
 * Inflate as much as the window holds, tolerating both a truncated window and
 * whatever follows the stream. Returns null when `off` is not a stream start.
 */
function inflateTolerant(buf, off, windowBytes) {
  try {
    return inflateRawSync(buf.subarray(off, Math.min(buf.length, off + windowBytes)), {
      finishFlush: constants.Z_SYNC_FLUSH,
      maxOutputLength: 256 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * Find where the stream starting at `off` ends, by locating its CRC trailer.
 *
 * The trailer is the CRC32 of the inflated bytes, so we know the four bytes we
 * are looking for before we look. A coincidental occurrence inside the
 * compressed data is rejected by re-inflating the exact candidate range under
 * Z_FINISH — the boundary is only accepted if the stream ends precisely there
 * and reproduces the same bytes.
 */
function findStreamEnd(buf, off, inflated) {
  const wanted = Buffer.alloc(4);
  wanted.writeUInt32LE(crc32(inflated), 0);
  for (let at = buf.indexOf(wanted, off + 2); at !== -1; at = buf.indexOf(wanted, at + 1)) {
    try {
      const exact = inflateRawSync(buf.subarray(off, at), { maxOutputLength: 256 * 1024 * 1024 });
      if (exact.length === inflated.length) return at;
    } catch {
      /* not the boundary — keep looking */
    }
  }
  return -1;
}

/** Walk the stub's streams from the overlay, yielding {off, size} for each. */
function* walkStubStreams(buf) {
  const overlay = overlayStart(buf);
  let off = -1;
  for (let i = overlay; i < overlay + FIRST_STREAM_SCAN; i++) {
    // Accept a candidate only on the same evidence the walk itself uses: it
    // inflates to something substantial and ends on a matching CRC trailer.
    const out = inflateTolerant(buf, i, WALK_WINDOW);
    if (!out || out.length < MIN_STREAM_BYTES) continue;
    if (findStreamEnd(buf, i, out) === -1) continue;
    off = i;
    break;
  }
  if (off === -1) throw new Error('no deflate stream found at the start of the overlay');

  for (let n = 0; n < MAX_WALK_STREAMS && off < buf.length; n++) {
    const out = inflateTolerant(buf, off, WALK_WINDOW);
    if (!out) return;
    const end = findStreamEnd(buf, off, out);
    if (end === -1) return;
    yield { off, size: out.length, data: out };
    off = end + 4;
  }
}

/** Parse the Wise script's install-file records. */
function parseRecords(script) {
  const text = script.toString('latin1');
  const recs = [];
  const re = /%[A-Z_]+%\\[^\0]{1,120}\0/g;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    const i = m.index;
    if (i < 44) continue;
    // 20 NUL bytes sit between the four u32 fields and the trailing 4 bytes.
    let padded = true;
    for (let k = i - 24; k < i - 4; k++) {
      if (script[k] !== 0) {
        padded = false;
        break;
      }
    }
    if (!padded) continue;
    const start = script.readUInt32LE(i - 40);
    const end = script.readUInt32LE(i - 36);
    const wiseCrc = script.readUInt32LE(i - 32);
    const size = script.readUInt32LE(i - 28);
    if (end <= start || size === 0) continue;
    recs.push({ start, end, wiseCrc, size, path: m[0].slice(0, -1) });
  }
  recs.sort((a, b) => a.start - b.start);
  return recs;
}

/**
 * Map `%MAINDIR%\music\1.mus` onto a path inside `outDir`, refusing anything
 * that tries to climb out. The record path is data read out of a file, so it is
 * screened before it becomes a filesystem write.
 */
function targetPath(outDir, recPath, lowercase) {
  const rel = recPath.replace(/^%[A-Z_]+%\\/, '').replace(/\\/g, '/');
  if (!rel || rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.split('/').includes('..')) {
    throw new Error(`refusing unsafe path from installer: ${recPath}`);
  }
  const full = resolve(outDir, lowercase ? rel.toLowerCase() : rel);
  if (full !== resolve(outDir) && !full.startsWith(resolve(outDir) + sep)) {
    throw new Error(`path escapes the output directory: ${recPath}`);
  }
  return full;
}

function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const [installer, outDir] = argv.filter((a) => !a.startsWith('--'));
  if (!installer || !outDir) {
    console.error('usage: extract-wise-installer.mjs <installer.exe> <outDir> ' + '[--lowercase] [--dry-run] [--force]');
    process.exit(2);
  }
  const dryRun = flags.has('--dry-run');
  const lowercase = flags.has('--lowercase');

  if (!dryRun && existsSync(outDir) && readdirSync(outDir).length > 0 && !flags.has('--force')) {
    console.error(`${outDir} is not empty — pass --force to write into it anyway`);
    process.exit(1);
  }

  const buf = readFileSync(installer);
  console.log(`${installer}: ${buf.length} bytes, overlay at 0x${overlayStart(buf).toString(16)}`);

  // The script is the first stub stream that names an install directory.
  const stub = [];
  let script = null;
  for (const s of walkStubStreams(buf)) {
    stub.push(s);
    if (!script && s.data.includes('%MAINDIR%\\')) script = s;
    if (script && stub.length > 24) break;
  }
  if (!script) throw new Error('no Wise script found in the stub streams');
  console.log(`script at 0x${script.off.toString(16)}, ${script.size} bytes inflated`);

  const records = parseRecords(script.data);
  if (records.length < 2) throw new Error(`expected a record table, found ${records.length} records`);
  console.log(`${records.length} file records`);

  // Derive the payload base: the first stub stream whose inflated size matches
  // record 0, with its successor matching record 1. Requiring two in a row
  // means a coincidental size collision cannot fix the base wrongly.
  let base = -1;
  for (let i = 0; i + 1 < stub.length; i++) {
    if (stub[i].size === records[0].size && stub[i + 1].size === records[1].size) {
      base = stub[i].off - records[0].start;
      break;
    }
  }
  if (base === -1) throw new Error('could not derive the payload base offset');
  console.log(`payload base 0x${base.toString(16)}`);

  let written = 0;
  let bytes = 0;
  let skipped = 0;
  for (const rec of records) {
    const blob = buf.subarray(rec.start + base, rec.end + base);
    if (blob.length !== rec.end - rec.start) throw new Error(`${rec.path}: payload runs past end of file`);
    const out = inflateRawSync(blob.subarray(0, -4), { maxOutputLength: 512 * 1024 * 1024 });
    if (out.length !== rec.size) {
      throw new Error(`${rec.path}: inflated ${out.length} bytes, record says ${rec.size}`);
    }
    const trailer = blob.readUInt32LE(blob.length - 4);
    const actual = crc32(out);
    if (actual !== trailer) {
      throw new Error(
        `${rec.path}: CRC32 ${actual.toString(16)} does not match trailer ${trailer.toString(16)}`,
      );
    }

    // %TEMP% records are the installer's own scratch files, not client files.
    if (!rec.path.startsWith('%MAINDIR%\\')) {
      skipped++;
      continue;
    }

    const dest = targetPath(outDir, rec.path, lowercase);
    if (!dryRun) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, out);
    }
    written++;
    bytes += out.length;
    console.log(`${dryRun ? 'ok  ' : 'wrote'} ${String(out.length).padStart(10)}  ${rec.path}`);
  }

  console.log(
    `\n${dryRun ? 'verified' : 'extracted'} ${written} files, ${bytes} bytes` +
      (skipped ? ` (${skipped} installer scratch records skipped)` : ''),
  );
}

export { overlayStart, walkStubStreams, parseRecords, crc32, targetPath };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
