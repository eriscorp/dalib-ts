# DALib (C#) — findings from the dalib-ts reconciliation

This document tracks defects `dalib-ts` found in the C# `DALib` library, and what upstream did
with them. `dalib-ts` is the TypeScript port, so the two libraries are expected to agree; where
they disagree, one of them is wrong and this file records which.

**The original six findings are all fixed upstream.** They are kept below in short form, because
the reasoning is the record of why each rule is what it is. Section 2 lists what is still open.

---

## 1. The original six — all adopted

Found during a reconciliation pass against a real 7.41 client and the `darkages-741-re`
file-format documentation, reported when the C# source was at `v1.0.0-beta2`. Upstream took all
six across `523b149` ("Fix six file-format bugs found by the dalib-ts 7.41 reconciliation"),
`ee57157` and `caa5380`. Verified against the C# source at `a59728e` on 2026-08-10.

| # | Finding | Adopted as |
| --- | --- | --- |
| 1 | `ControlFileParser` expanded `<IMAGE>` as a frame range, not an ordered list, fabricating frames that do not exist (`0, 1, 3` → `0, 1, 2, 3`) and shifting every later button state | The range fill is deleted; the list is kept as parsed |
| 2 | Ground tiles rendered palette index 0 as transparent and applied no isometric mask, leaving holes plus garbage outside the diamond | A dedicated `RenderTile` replaces the `SimpleRender` call, masking to the diamond and drawing index 0 opaque. `SimpleRender` keeps the index-0 rule, which is correct for sprites |
| 3 | `MapFile` read tile IDs as signed `short`, so any `stc` foreground id above 32767 read negative, and rejected any file whose length was not exactly `width * height * 6` | IDs read as `ushort`; the length check rejects only files too short to hold the cell array |
| 4 | `HeaFile` used the full run byte as the light value, so a set flag bit corrupted the intensity | Masked with `& 0x3F` |
| 5 | `SpfFile` decode used absolute `Right`/`Bottom` as dimensions and read pixels contiguously, ignoring `Left`/`Top` and the `ByteWidth` pitch | Both readers use the visible rectangle and skip row padding; palettized frames de-pad through `CompactPalettizedRows` |
| 6 | `PaletteTable` split each line on a single space, so a trailing `// comment` or a run of spaces silently dropped the entry | A `Tokenize` helper strips the comment and splits on whitespace runs |

Finding 5 travelled in both directions. Upstream's follow-up (`ee57157`) also corrected the
colorized `ImageByteCount` to `pixelCount * 2`, which **`dalib-ts` had wrong** — it wrote a pixel
count, halving the field on every save. Fixed here in 3.1.1.

---

## 2. Still open upstream

### 2.1 `PaletteTable` range expansion has no allocation cap

- **File:** `DALib/Drawing/PaletteTable.cs`, the `min..paletteNumOrMax` expansion
- **Severity:** Medium. Denial of service against a hostile or corrupt archive, not code execution.

A `min max palette` line expands one map entry per id with no bound, so a crafted `.tbl` holding
`1 999999999 5` exhausts memory or ties up the process. `Tokenize` (finding 6) landed; the cap
did not. Tracked internally as HTOO-163, whose dalib-ts half shipped in 3.1.1.

**The bounds are measured against a retail 7.41 install, and are reusable directly:**

| Measurement | Value |
| --- | --- |
| Widest span in a real palette table | 527 (`ia.dat:stspal.tbl`) |
| Widest span in any `.tbl` | 3,196 (`cious.dat:rs_linfo.tbl`) |
| Largest id of any kind | 20,424 |
| Largest whole-file iteration count | 140,724 (`ia.dat:stcpal.tbl`) |

`dalib-ts` uses 65,536 per line and 1,000,000 per file. **Two traps worth copying rather than
rediscovering:**

- **Count iterations, not distinct ids.** Retail ranges overlap heavily — `stcpal.tbl` iterates
  140,724 times to produce far fewer keys — so an aggregate cap written against distinct ids
  would sit near 20,000 and reject real data.
- **Drop the offending line; do not fail the file.** A stock install contains **163 reversed
  ranges, none of them in a palette table** — they are in `MobTile.tbl` (106), `meffect.tbl` (15)
  and the `skill*.tbl` family, which share the extension but not the grammar. Those lines produced
  nothing before any guard, because the loop simply did not execute. Rejecting the file would be a
  regression against stock data.

Checked equivalent across 331 retail `.tbl` files and 81,985 ids: zero mappings changed.

### 2.2 `PaletteResolver` diverges from the frozen ruleId contract

- **File:** `DALib.Tests/PaletteResolverTests.cs`
- **Severity:** Medium. Two libraries name the same rule differently.

`tests/fixtures/palette-resolution.json` in this repo is the cross-port conformance fixture: the
ruleId strings are a frozen contract, because a host reports the ruleId so that a wrong palette
guess is reportable rather than merely wrong. The C# port (`caa5380`) builds its own fixtures
instead of reading it, and four ids diverge:

| dalib-ts (contract) | C# |
| --- | --- |
| `setoa/album_b` | `setoa/album` |
| `legend/clock01` | `legend/emo` |
| `misc/legend` | `misc/all` |
| `national/legend` | `national/all` |

Either side can be the winner, but they have to agree, and the fixture is the artifact that keeps
them agreeing. Reconciling the names is a cross-repo decision.

### 2.3 `PaletteResolver` covers `.epf` only

- **File:** `DALib/Drawing/PaletteResolver.cs`
- **Severity:** Low. A gap, not a defect.

Its own comment records that `.hpf`, `.mpf` and tilesets are specified but unimplemented.
`dalib-ts` implements all of them — `hpf/stc`, `hpf/sts`, `mpf/mns`, `tileset/mpt`, `tileset/mps`.

---

## 3. Checked and NOT reported

These look similar but are not C# defects. The list saves the search.

| Item | Why it is not a bug in C# |
| --- | --- |
| SPF mode read as one `uint32` vs two `uint8` | The `uint32` values `0` and `2` classify the same as the per-byte read for every real 7.41 asset. No known file differs. |
| MetaFile non-ASCII write | C# derives the `uint16` length prefix from the CP949-encoded bytes and writes those same bytes. The prefix always matches. |
| Palette `.tbl` IDs one-based on disk | C# does not subtract 1, and `dalib-ts` matches this on purpose. A shared, documented divergence from the client, not a defect. |
| `CompactPalettizedRows` at parse vs at render | C# de-pads palettized rows while parsing; `dalib-ts` de-pads in `renderSpfPalettized`. **Zero row-padded frames exist in 1,671 retail frames**, so neither path ever runs. The `dalib-ts` choice keeps a padded source byte-exact through a round trip. A deliberate divergence. |

---

## Out of scope for dalib-ts

`DALib/Networking` (~160 packet classes plus crypto) and the **Foscail** CLI have no `dalib-ts`
counterpart and are not tracked here. See `docs/plans/dalib-ts-followups.md` for the networking
decision.

---

*Findings are verified against a real 7.41 client install and re-checked against the current C#
source before being listed as open. Confirm line numbers against your own checkout.*
