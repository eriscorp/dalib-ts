# dalib-ts follow-ups

Running list of dalib-ts work to batch into the next pass. Grouped so the whole
set can be tested together (parser hardening + the pending FntFile reversal).

## Context

Taliesin surfaced a hard crash while previewing a `.tbl` asset (`stspal.tbl`):
V8 ran out of memory (~4 GB heap) and the app died with
`Ineffective mark-compacts near heap limit`. Root cause is a parser bug in
dalib-ts, not the consumer. Taliesin has since added a defensive guard on its
side (see "Consumer guard already in place" below), but the library itself
should be fixed so every consumer is protected.

There was also a **FntFile reversal** change (author: Sabrael); it has since
**landed** (see section 2). The ColorTable hardening in section 1 is still open.

---

## 1. ColorTable.parseText — unbounded allocation (OOM) — DONE

**Landed.** `src/drawing/ColorTable.ts` now clamps the header via
`MAX_COLORS_PER_ENTRY = 64` (out-of-range → empty table) and breaks the inner
color loop at EOF (`colorLine === undefined`) instead of padding black
placeholders — while still treating an empty-but-present line as a transparent
color. Regression tests in `tests/colorTable.test.ts` cover: normal parse, empty
line → transparent, huge-header rejection (no runaway allocation), and truncated
final entry stopping at EOF. Original analysis retained below.

`src/drawing/ColorTable.ts` → `ColorTable.parseText(text)`.

The format's first line is a "colors per entry" count. The parser trusts it
blindly:

- It reads `colorsPerEntry = parseInt(firstLine, 10)` and only rejects
  `NaN`/`<= 0`. A huge value (e.g. a non-dye-table `.tbl`, or a binary blob
  mis-decoded as text) is accepted.
- For each entry it loops `for (i = 0; i < colorsPerEntry; i++)` pushing a color
  object, and on EOF it **does not break** — `if (!colorLine)` pushes a black
  placeholder and `continue`s. So a single entry with a large `colorsPerEntry`
  allocates that many objects regardless of how short the file actually is.

Result: a ~40 KB file whose first line decodes to a large integer makes the
parser allocate billions of objects → OOM. The caller's `try/catch` cannot help
because the process dies mid-loop.

### Fix

- **Clamp / validate `colorsPerEntry`** to a sane maximum. Real Dark Ages dye
  tables use ~6 colors per entry (`emptyColorTableEntry` hardcodes 6); a bound
  like `<= 64` is generous. Return the empty table (or throw a typed
  `InvalidColorTableError`) when the header is out of range.
- **Break at EOF** in the inner color loop instead of padding to `colorsPerEntry`
  — a truncated final entry should stop, not allocate the full count.
- Consider a cheap "looks like a dye table" precheck (first line is a small
  integer) so non-dye `.tbl` files fail fast rather than being parsed at all.

### Tests to add

- A `.tbl` whose first line is a large number → parser returns empty/throws,
  allocates nothing pathological (assert it completes, not a timeout).
- A truncated table (declared count > lines present) → the last entry stops at
  EOF; no runaway padding.
- Regression: a real dye table still parses to the expected entries/colors.

### Upstream comparison (C# DALib)

`DALib/Drawing/ColorTable.cs` shares the root weakness — it also reads
`colorsPerEntry` with no upper bound — but is more resilient in two ways the TS
port lost:

- **C# breaks at EOF.** Its inner loop is
  `for (i = 0; (i < colorsPerEntry) && !reader.EndOfStream; ++i)`. The TS port
  **dropped the `!reader.EndOfStream` half**, so on EOF it keeps padding black
  placeholders up to the full count. That runaway padding is the specific
  behavior that OOM'd Taliesin — a **port regression**, not in DALib.
- **C# allocates one `new SKColor[colorsPerEntry]`** (compact struct array), so a
  huge count throws a single catchable `OutOfMemoryException` fast, instead of
  the incremental `push` heap-thrash JS does.

So restoring the EOF break is the port-specific fix; the `colorsPerEntry` clamp
is worth doing in **both** libraries (a valid `byte` colorIndex line + a huge
header could still OOM the one C# array allocation). Consider filing the clamp
upstream when this lands.

### Consumer guard already in place (Taliesin)

`taliesin/src/renderer/src/components/archive/ArchivePreview.tsx` now:
- Only calls `ColorTable.fromBuffer` when the `.tbl` header's first line is an
  integer in `1..64` (`tryParseColorTable`).
- Caps decoded preview text at 256 KB and caps rendered swatch rows at 512.

This unblocks Taliesin regardless, but is a band-aid around the library bug — the
real fix belongs here so other consumers (Creidhne, Brigid tooling, etc.) don't
each reinvent the guard.

---

## 2. FntFile reversal (DONE — landed in `ac894de` / v2.1.0)

Resolved. `src/drawing/FntFile.ts` `getGlyphData`/`getGlyphPixels`.

**What the reversal changed:** the intra-byte bit order was corrected from
**LSB-first** (bit 0 = leftmost pixel) to **MSB-first** (bit 7 = leftmost pixel).
The commit fixed the `getGlyphData` doc-comment (it had wrongly claimed LSB-first)
and added `getGlyphPixels()`, which decodes MSB-first
(`(byte >> (7 - (x & 7))) & 1`).

**Why:** MSB-first is the canonical retail `.fnt` layout — it matches C# DALib
(`DALib/Drawing/Graphics.cs` `DrawGlyph`, `pixelX = x + byteIdx*8 + (7-bit)`), and
dalib-ts's own renderer `drawGlyph` was already MSB-first. The stale doc-comment was
the only actual defect; it had led Taliesin to carry an independent MSB-first
workaround with a comment rejecting the (old) docs. dalib-ts HEAD now agrees with
DALib and with Taliesin.

**Note — no glyph-geometry bug ever existed.** The renderer, `getGlyphPixels`, and
downstream consumers all agree on MSB-first; this was purely a doc/contract fix.

### Tests

- `tests/fntFile.test.ts` asserts MSB-first on synthetic bytes (8×2 and 16×1 cells),
  raw-byte passthrough, and `RangeError` bounds.
- Added: a round-trip of a known left-heavy 8×12 glyph ("F"), encoded MSB-first and
  decoded via `getGlyphPixels`, plus an assertion that the shape diverges under
  LSB-first — so a regression to the old bit order fails the test. Realized as a
  synthetic fixture because the repo commits no binary assets (every format test
  synthesizes its buffer).

---

## 3. MPF variable-length "Unknown" header (DONE — ported from C# DALib `20aebba`, issue #10)

**Landed.** `src/drawing/MpfFile.ts` and `src/drawing/virtualized/MpfView.ts`.

**What it fixes:** the MPF `Unknown` (0xFFFFFFFF magic) header carries a
variable-length run — when **bit 2** of the flags field is set, a `u32 count`
follows, then `count * 4` bytes. The old TS parser did a `num === 4` compare and
read a **fixed 8 bytes**, which is correct only for `flags == 4, count == 1`. Any
other `count`, or bit 2 set alongside other bits (e.g. `0x06`, `0x14`), mis-aligned
every field after the header. Now: test `(flags & 4) !== 0`, read the `u32 count`,
then `count * 4` bytes; store the whole run verbatim so `toUint8Array` round-trips.
`MpfView` advances past the same run. Serialization already wrote the header bytes
verbatim, so only the parse paths changed.

**Tests:** `tests/mpfFile.test.ts` — the 6 `InlineData` cases from C#
`MpfHeaderTests.cs` (`0x04/1`, `0x04/3`, `0x06/2`, `0x14/5`, `0x00/0`, `0x02/0`),
each asserting header length and a byte-for-byte round-trip.

---

## 4. CRC-32 `finalXor` flag (DONE — ported from C# DALib `39b845e`)

**Landed.** `src/cryptography/CRC32.ts`. Added a `finalXor = true` parameter: when
`false`, the standard final inversion (`~result`) is omitted — the Dark Ages wire
protocol uses the non-inverting variant for metafile/notice/server-table checksums.
Default `true` preserves existing behavior (zlib/PNG CRC-32). Tests in
`tests/crc32.test.ts` (standard check value, non-inverting variant, offset/count).
Ported now because the deferred `dalib-net-ts` sibling will depend on it.

---

## 5. C# DALib Data-layer items — intentionally NOT ported

Decision (2026-07-18): both are skipped. Recorded here so they don't get re-raised
as "missing" catch-up work.

- **`MemoryMappedDataArchive`** — no browser-safe TS analog. It relies on
  `System.IO.MemoryMappedFiles`; neither Node's standard library nor the browser has
  mmap. `DataArchive.ts` already documents this omission ("The underlying buffer is
  held in memory — there is no memory-mapped equivalent in the JS port"), and its
  zero-copy `subarray` views already avoid duplicating archive bytes. A real analog
  would be an fd-based lazy reader that is **Node-only**, breaking dalib-ts's
  "works in both Node.js and browsers" charter. Not worth it; no consumer needs it.
- **`PatchEntry`** — inert without infrastructure dalib-ts deliberately lacks. It
  only feeds C# `DataArchive.Patch(name, ISavable)`; dalib-ts has no `patch()` method
  and no `ISavable` interface (its write path is `toUint8Array()` /
  `compileFromDirectory()`). Porting it alone does nothing; making it useful means a
  whole patch/ISavable abstraction no current consumer needs (Taliesin authors
  `.datf`, not `.dat` patches; Creidhne edits world data).

Revisit only if a consumer genuinely needs archive patching or lazy `.dat` streaming.

---

## Sequencing

One dalib-ts release bundles: ColorTable hardening (§1) + FntFile reversal (§2,
already landed) + MPF variable-length header (§3) + CRC-32 `finalXor` (§4), with the
tests above. §5 (Data-layer) is intentionally skipped. Then cut a new
`@eriscorp/dalib-ts` version and bump the consumers (Taliesin, Creidhne). Taliesin's
ColorTable guard can stay as defense-in-depth after the library fix ships.

**Deferred to its own effort (not in this release):** the **networking** layer — the
bulk of the 0.7.0→1.0.0 C# delta is a new `DALib/Networking` module (~160 packet
classes + wire framing + packet-crypto + opcodes; no TCP sockets). No TS
DA-networking exists yet. Decided: it will live in a **sibling `dalib-net-ts`**
(depending on dalib-ts for byte primitives), keeping dalib-ts asset-only. Real
sockets/session/proxy transport stay out of both.
