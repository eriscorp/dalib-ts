# dalib

TypeScript library for parsing and manipulating [Dark Ages](https://www.darkages.com/) (DOOMVAS v1) game client files.

Translated from [eriscorp/dalib](https://github.com/eriscorp/dalib), the original C# implementation, under the MIT license.

---

## Installation

```bash
npm install dalib
```

---

## Supported Formats

| Format | Class(es) | Description |
|--------|-----------|-------------|
| `.dat` | `DataArchive`, `DataArchiveEntry` | Game data archives |
| `.map` | `MapFile` | Map layout files |
| `.meta` | `MetaFile`, `MetaFileEntry` | Metadata files |
| `.hpf` | `HpfFile` | Tile graphics |
| `.spf` | `SpfFile`, `SpfFrame` | Sprite frames |
| `.epf` | `EpfFile`, `EpfFrame` | Entity / mob sprites |
| `.mpf` | `MpfFile`, `MpfFrame` | Map sprites |
| `.efa` | `EfaFile`, `EfaFrame` | Effect animations |
| `.fnt` / `.hea` | `FntFile`, `HeaFile` | Bitmap fonts |
| `.tbl` | `PaletteTable`, `ColorTable`, `TileAnimationTable`, `EffectTable` | Lookup tables |
| `.control` | `ControlFile`, `Control` | UI layout files |

---

## Usage

### Reading a data archive (Node.js)

```ts
import { DataArchive } from 'dalib';

const archive = DataArchive.fromFile('path/to/archive.dat');

// List all .spf entries
const sprites = archive.getEntriesByExtension('.spf');

// Get a specific entry's raw bytes
const entry = archive.get('sprite001.spf');
if (entry) {
  const buffer = archive.getEntryBuffer(entry);
}
```

### Reading a data archive (browser)

```ts
import { DataArchive } from 'dalib';

const response = await fetch('archive.dat');
const buffer = await response.arrayBuffer();
const archive = DataArchive.fromBuffer(buffer);
```

### Parsing a sprite file

```ts
import { DataArchive, SpfFile, Palette } from 'dalib';

const archive = DataArchive.fromFile('seo.dat');

const spfEntry = archive.get('sprite001.spf')!;
const palEntry = archive.get('sprite001.pal')!;

const spf = SpfFile.fromBuffer(archive.getEntryBuffer(spfEntry));
const palette = Palette.fromBuffer(archive.getEntryBuffer(palEntry));
```

### Rendering to ImageData

```ts
import { renderSpfPalettized } from 'dalib';

const frame = spf.frames[0];
const rgbaFrame = renderSpfPalettized(frame, palette);

// rgbaFrame.data is a Uint8ClampedArray — pass directly to ImageData
const imageData = new ImageData(rgbaFrame.data, rgbaFrame.width, rgbaFrame.height);
ctx.putImageData(imageData, 0, 0);
```

---

## API Overview

### Binary I/O
- `SpanReader` — low-level binary reader (LE/BE integers, fixed-length ASCII, byte spans)
- `SpanWriter` — low-level binary writer
- `compressHpf` / `decompressHpf` — HPF tile compression

### Cryptography
- `crc16(data)` — CRC-16 checksum
- `crc32(data)` — CRC-32 checksum

### Utilities
- `decodeRgb555` / `encodeRgb555` — RGB555 color codec
- `decodeRgb565` / `encodeRgb565` — RGB565 color codec
- `quantizeFrames` — palette quantization for image export
- `cropTransparentPixels` — trim transparent borders from frames

### Virtualized (lazy) Views
For large archives, avoid decoding everything upfront:
- `SpfView`, `EpfView`, `MpfView`, `EfaView`, `TilesetView`

These decode individual frames on demand rather than parsing the entire file.

---

## License

[MIT](LICENSE)
