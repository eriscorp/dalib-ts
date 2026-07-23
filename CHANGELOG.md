# Changelog

All notable changes to `@eriscorp/dalib-ts` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Findings from reconciling the library against the `darkages-741-re` file-format
documentation, validated against a real 7.41 client install.

### Added

- **`SotpFile`** — reader for `SOTP.DAT` (per-static-tile collision and render flags).
  Byte 0 is static tile ID 1; the low nibble is per-direction collision and the high
  nibble is render flags. Exposes `getCollision`/`getRenderFlags`/`blocksMovement`/
  `canMove`/`isOverPlayer`, plus `SotpDirection`, `SOTP_EMPTY_TILE_ID`, and
  `SOTP_RENDER_OVER_PLAYER`.
- **`LftFile`** — reader for the LFT bitmap fonts (`da.lft`/`lod.lft` in `national.dat`),
  the format the client actually renders text with. Carries per-glyph advance and bounds,
  with `getGlyphPixels`/`getAdvance` and the `lftGlyphWidth`/`lftGlyphHeight`/
  `lftRowStride` helpers. **`FntFile` is now documented as the dormant font format** —
  its loaders have no callers in the 7.41 client.
- **LFT text rendering** in `Graphics`: `renderLftText`, `measureLftText`, `drawLftGlyph`,
  and `lftGlyphKeys` (with a DBCS lead-byte path), using real per-glyph metrics instead of
  the fixed-cell approximation the FNT path uses.
- **`colorKey` parameter on `renderPalettized`** (default `true`). Lets ground/background
  callers draw palette index 0 as an opaque color.

### Fixed

- **Ground tiles rendered index 0 as holes and showed padding as garbage.** `renderTile`
  now draws palette index 0 opaque and masks everything outside the isometric diamond to
  transparent. Verified against `TILEA.BMP`: ~417k index-0 pixels across 1,143 tiles and
  1,100 stray padding bytes across 65 tiles were affected.
- **SPF frames ignored `left`/`top` and `pitch`.** Both the colorized decode in `SpfFile`
  and the palettized `renderSpfPalettized` path now use `right - left` / `bottom - top`
  for dimensions and advance rows by the frame's pitch. Affected 190 (offset) + 78 (pitch)
  of 982 real frames.
- **SPF mode bytes were read as one `uint32`.** They are two `u8`s (`pixelMode` at +0x08,
  `paletteMode` at +0x09) followed by two preserved bytes; the embedded palette block is
  gated on both being zero. New `SpfFile.paletteMode` / `reservedModeBytes` fields;
  round-trips existing files byte-for-byte.
- **`ControlFile` invented UI frames.** The `<IMAGE>` block is an ordered list, not a
  frame range; the old start/end expansion turned non-consecutive runs like
  `_nemot.spf` 0, 1, 3 into 0, 1, 2, 3 and shifted button states.
- **`HeaFile`** now masks run intensity with `& 0x3F` (the top two bits are unidentified
  flags).
- **`MapFile`** reads tile IDs as unsigned and accepts trailing bytes (rejecting only
  short files), matching the client's `file_read_map_cells`.
- **`MetaFile`** now throws when asked to write non-ASCII values instead of silently
  emitting UTF-8, which would corrupt the `uint16` length prefixes.
- **`DataArchive`** detects the extended (`0xFFFFFFFF`) archive header and throws a clear
  error rather than reading it as a huge entry count.
- **`PaletteTable`** strips `//` comments (including trailing ones) and tolerates runs of
  whitespace between tokens. Documented that its asset IDs are keyed one-based as they
  appear on disk (the client subtracts 1); moving that adjustment into the library is a
  deferred, cross-repo breaking change.

### Internal

These changes do not affect the published package. They are recorded because the
dependency bump closes advisories that a `npm audit` against this repository reports.

- **Continuous integration.** Added a workflow that runs on every pull request and on
  every push to `main`: type check, tests with the coverage gate, build, then
  `npm audit`. The repository previously ran no tests in CI; the publish workflow only
  built and published on a release.
- **Coverage gate.** Added `@vitest/coverage-v8` with the v8 provider and global floors
  that fail the build when coverage drops. Line coverage went from 37.9% to 99.5% and
  the suite from 109 to 530 tests, across the parsers, the renderers, the lazy views,
  the RGBA builders and every archive and file factory. Tests that need a real client
  install read `DALIB_CLIENT_DIR` and skip when it is absent, so CI commits no binary
  assets and reproduces locally.
- **Bumped `vitest` to 4.x**, which clears four advisories (one critical, one high, two
  moderate) that came in through the 1.x tree. All are development dependencies.

## [2.2.0] - 2026-07-18

Acts on the upstream findings in Taliesin's `dalib-findings.md`, plus a batch of
parser fixes. Version 2.1.0 was prepared but never tagged or published; the
readers below first shipped in 2.2.0.

### Added

- **`PcxFile`** and **`renderPcx`** — 8-bit single-plane PCX with the embedded
  256-color palette.
- **`BikFile`** — Bink Video header reader. It reports the metadata (version,
  dimensions, frame count, frame rate, audio track count). It does not decode video.
- **`JpfFile`** — unwraps a `.jpf` entry by removing the 4-byte `"JPF\0"` prefix and
  exposes the inner JPEG bytes.
- **`FntFile.getGlyphPixels`** — returns a decoded one-byte-per-pixel buffer.
- **`DataArchiveOptions`** (`{ newFormat?, onWarning? }`) on `DataArchive`. The
  positional `newFormat` boolean still works.
- **`finalXor` parameter on `crc32`** (default `true`). Set it to `false` to omit the
  final inversion, which the Dark Ages wire checksums need.

### Fixed

- **`ColorTable` allocated without bound on a non-dye table.** `parseText` now clamps
  the colors-per-entry header to 64 and stops at end of file instead of padding the
  last entry with black. A large first line previously exhausted memory in Taliesin's
  `.tbl` preview. An empty but present color line still decodes as transparent.
- **The MPF variable-length "Unknown" header was read at a fixed size.** When flags
  bit 2 is set, `MpfFile` and `MpfView` now read a `u32` count and then `count * 4`
  bytes. The old fixed eight-byte read was correct only for a count of 1 and
  mis-aligned every later field otherwise. Ports the C# DALib fix (issue #10).
- **`DataArchive` rejected duplicate and empty entry names.** It now reports them
  through `onWarning` instead of throwing, which is needed to open `album.dat` and
  `WorldMap.dat` from the official client.
- **The `FntFile` bit-order docstring said LSB-first.** The glyph data is MSB-first,
  which is what `drawGlyph` already assumed.

## [2.0.0] - 2026-04-20

Tracks upstream **eriscorp/dalib DALib 0.7.0** (PRs #13 and #14).

### Breaking changes

- **MPF animation fields reworked.** `MpfFile.optionalAnimationRatio` is removed. The same on-disk byte now decodes into one of two semantic fields based on the file's idle type:
  - `animationIntervalMs` — the inter-frame interval in milliseconds (for `NormalIdle`), normalized to `300` when the raw byte is `0` and floored to `100` otherwise.
  - `optionalAnimationProbability` — the 0-255 probability that the optional animation plays per idle cycle (for `NormalPlusOptional`).

  Migration: call `MpfFile.detectIdleType(standingFrameCount, optionalAnimationFrameCount)` (or read `mpf.idleType`) and read the appropriate field. The on-disk byte layout is unchanged — round-tripping an existing `.mpf` produces the same bytes, except for one benign case: `NormalIdle` with raw byte `0` re-serializes as `3` (matches upstream behavior, since raw `0` is normalized to the 300 ms default).

- **SPF `SpfFrame.unknown2` replaced with named fields.** The 8 bytes we previously parsed as `skip(4) + unknown2(u32)` are now parsed as `centerX(i16) + centerY(i16) + flags(u32)`. Wire layout is identical — this is a rename, not a format change.
  - Added: `centerX`, `centerY` (signed 16-bit), `flags` (raw uint32), `hasCenterPoint` (alias for `(flags & 1) !== 0`).
  - `SpfFile.FRAME_UNKNOWN1` constant removed — it is no longer meaningful.

  Migration: replace `frame.unknown2` reads with `frame.flags`. For writers that previously zeroed `unknown2`, initialize `centerX`/`centerY`/`flags` (to `0`, `0`, `0` if center-point is not applicable, or to actual anchor values with `flags |= 1`).

### Added

- `MpfIdleType` enum: `StaticNoIdle`, `NormalIdle`, `NormalPlusOptional`.
- `MpfFile.detectIdleType(standingFrameCount, optionalAnimationFrameCount)` static classifier.
- `MpfFile#idleType` getter (sugar for the static call against `this`).
- `AlphaMode` enum and optional `alphaMode` parameter on `renderPalettized`, `renderColorized`, `renderSpfPalettized`, `renderSpfColorized`, `renderMpf`, `renderEpf`, `renderHpf`, `renderTile`, `renderEfa`. Defaults to `AlphaMode.Straight` (canvas-compatible); pass `AlphaMode.Premultiplied` for consumers that need baked-in alpha (WebGL texture uploads, OffscreenCanvas in premultiplied mode, native wrappers).
- `renderEpf` zero-dimension guard: returns a `1×1` transparent frame when `width <= 0` or `height <= 0` (mirrors upstream's `RenderImage(EpfFrame)` guard).

### Unchanged (already correct)

- `MapFile` tile serialization — already uses `int16` for background / left / right foreground, and already validates `width * height * 6` byte length.
- `EpfFile.parse` empty-frame guard — already short-circuits before reading data when `width === 0` or `height === 0`.

## [1.0.1] - 2026-04-10

Verification release exercising the npm trusted-publishing OIDC path end-to-end. No code changes from 1.0.0.

## [1.0.0] - 2026-04-10

Initial public release of `@eriscorp/dalib-ts` on npmjs.org. TypeScript port of the Dark Ages game-asset library covering DAT/MAP/SPF/EPF/MPF/HPF/EFA/HEA/FNT/Tileset parsing and rendering.

<!-- Version 2.1.0 has no entry: it was prepared but never tagged or published. -->

[Unreleased]: https://github.com/eriscorp/dalib-ts/compare/v2.2.0...HEAD
[2.2.0]: https://github.com/eriscorp/dalib-ts/compare/v2.0.0...v2.2.0
[2.0.0]: https://github.com/eriscorp/dalib-ts/compare/v1.0.1...v2.0.0
[1.0.1]: https://github.com/eriscorp/dalib-ts/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/eriscorp/dalib-ts/releases/tag/v1.0.0
