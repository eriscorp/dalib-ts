# DALib (C#) — findings from the dalib-ts 7.41 reconciliation

This document lists bugs in the C# `DALib` library. The `dalib-ts` TypeScript port found these
bugs during a reconciliation pass against a real Dark Ages 7.41 client and the `darkages-741-re`
file-format documentation. The port fixed each one. The C# source still has each bug.

Every verdict below cites the exact C# file and line. The line numbers match the `DALib` source at
the time of writing (post `v1.0.0-beta2`). Confirm the lines against your checkout before you patch.

The findings are ranked by impact. The first three are unambiguous and self-contained.

---

## 1. ControlFile expands `<IMAGE>` as a frame range, not an ordered list

- **File:** `DALib/Utility/ControlFileParser.cs:39-55` (the `EndControl` handler)
- **Severity:** High. It fabricates frames that do not exist.

### Problem

The parser reads the first and last `FrameIndex` for each image name. It then fills the whole
inclusive range:

```csharp
for (var i = startNum; i <= endNum; i++)
    expandedImages.Add(/* frame i */);
```

The `<IMAGE>` block is an ordered list of frames, not a start/end range. A sparse list like
`0, 1, 3` becomes `0, 1, 2, 3`. The extra frame `2` does not exist. This shifts every later frame
and breaks button states in UI controls (for example `_nemot.spf`).

### Fix

Keep the image list as read. Do not fill the gap between the first and last index.

---

## 2. Ground tiles render palette index 0 as transparent, and apply no diamond mask

- **File:** `DALib/Drawing/Graphics.cs:1184` (in the `byte[]` overload of `SimpleRender`)
- **Severity:** High. It affects every background tile.

### Problem

`SimpleRender` forces palette index 0 to transparent for all palettized renders:

```csharp
var color = paletteIndex == 0 ? CONSTANTS.Transparent : palette[paletteIndex];
```

This rule is correct for sprites. It is wrong for ground and background tiles. On a ground tile,
index 0 is an ordinary opaque color. The client draws it. C# drops it and leaves holes.

`SimpleRender` also applies no isometric mask. The pixels outside the tile diamond stay in the
output as garbage. The client masks them to transparent.

### Fix

Add a color-key flag to the tile render path. Draw index 0 opaque for tiles. Mask the pixels
outside the isometric diamond to transparent.

---

## 3. MapFile reads tile IDs as signed, and rejects trailing bytes

- **File:** `DALib/Data/MapFile.cs:34` (length check), `:42-44` (reads), `:145/:150/:155` (`short` fields)
- **Severity:** High. Signed reads are provably wrong for real maps.

### Problem 3a — signed tile IDs

The map cell fields are `short` (signed int16). The foreground index uses the name pattern
`stc{index:D5}`, so it holds five digits (up to 99999). Any value above 32767 reads as a negative
number. The client reads these IDs as unsigned (`file_read_map_cells`).

### Problem 3b — strict length check

The constructor rejects any file whose length is not exactly `width * height * 6`:

```csharp
if (stream.Length != (width * height * 6)) throw ...;
```

Real map files carry trailing bytes. The client accepts them. The check must reject only files
that are too short.

### Fix

Read the tile IDs as unsigned. Change the length check to reject only short files.

---

## 4. HeaFile does not mask the run intensity with `& 0x3F`

- **File:** `DALib/Drawing/HeaFile.cs:198` (raw read), `:207` (`.Fill(value)`), `:24` (`MAX_LIGHT_VALUE = 0x20`)
- **Severity:** Medium. Confirm against a real `.hea` sample before you patch.

### Problem

The decoder uses the full run byte as the light value. The `darkages-741-re` documentation states
that the top two bits are flags. `MAX_LIGHT_VALUE` is `0x20`, so a set flag bit corrupts the
intensity.

### Fix

Mask the run byte with `& 0x3F` before you use it as the light value.

> Note: the flag claim comes from the reverse-engineering docs, not from a live client trace. Test
> with real `.hea` data before you commit.

---

## 5. SpfFile decode ignores Left/Top and the row pitch

- **File:** `DALib/Drawing/SpfFile.cs:143-150` (`ReadColorized`), `:200-205` (`ReadPalettized`);
  mirrored in `DALib/Drawing/Virtualized/SpfView.cs:174, :181-183`
- **Severity:** Medium. It only affects frames with a nonzero origin or a padded pitch.

### Problem

The decode loops use the absolute `Right` and `Bottom` as the dimensions. They must use
`Right - Left` and `Bottom - Top`. The loops also read pixels contiguously. They never use
`ByteWidth` (the pitch) for the row stride, and they ignore `Left` and `Top`. Frames with a
nonzero origin or a padded pitch decode wrong.

### Fix

Use `Right - Left` and `Bottom - Top` for the frame size. Advance each row by `ByteWidth`. Honor
`Left` and `Top` for the destination offset.

---

## 6. PaletteTable does not strip `//` comments or tolerate whitespace runs

- **File:** `DALib/Drawing/PaletteTable.cs:75-77` (the split and guard); the same flaw is in
  `ParseCyclingFile` at `:356-377`
- **Severity:** Low. Confirm that real `.tbl` assets contain comments before you patch.

### Problem

The parser splits each line on a single space and handles only two- or three-token lines:

```csharp
var parts = line.Split(' ');
```

A trailing `// comment` produces four or more tokens. The line falls through the switch and the
entry drops silently. A run of spaces produces empty tokens, and `int.TryParse` fails.

### Fix

Strip a `//` comment before you split. Split on runs of whitespace, or drop the empty tokens.

---

## Checked and NOT reported

These items look similar but are not C# bugs. The list saves you the search.

| Item | Why it is not a bug in C# |
|------|---------------------------|
| SPF mode read as one `uint32` vs two `uint8` (`SpfFile.cs:80`) | The `uint32` values `0` and `2` classify the same as the per-byte read for every real 7.41 asset. No known file differs. |
| MetaFile non-ASCII write (`MetaFile.cs:97-113`) | C# derives the `uint16` length prefix from the CP949-encoded bytes and writes those same bytes. The prefix always matches. C# is already safe. |
| Palette `.tbl` IDs one-based on disk | C# does not subtract 1 (`PaletteLookup.cs:51-79`). The `dalib-ts` port matches this on purpose. It is a shared, documented divergence, not a C# bug. |

---

*Source: `dalib-ts` reconciliation against `darkages-741-re` and a real 7.41 client install. Each
finding above was re-verified against the current C# `DALib` source.*
