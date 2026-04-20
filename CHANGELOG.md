# Changelog

All notable changes to `@eriscorp/dalib-ts` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
