import { KhanPalOverrideType } from '../enums.js';

/**
 * The four palette source kinds.
 * See the document repo: docs/architecture/palette-resolution.md §1.1.
 *
 * - `table`: a PaletteLookup over a `.tbl` file and `.pal` entries.
 * - `indexed`: a palette-number → Palette map, with no table.
 * - `fixed`: one named `.pal` entry.
 * - `constant`: an indexed map, keyed by a number written in the rule.
 */
export type PaletteSourceKind = 'table' | 'indexed' | 'fixed' | 'constant';

/**
 * How the resolver derives the palette id from the entry and the frame index.
 *
 * - `identifier`: `entry.tryGetNumericIdentifier()`.
 * - `identifierPlus1`: `entry.tryGetNumericIdentifier() + 1` (`.hpf` tiles).
 * - `identifier3`: `entry.tryGetNumericIdentifier(3)` (khan entries).
 * - `legendItem`: `(identifier - 1) * 266 + frameIndex + 1` (legend items).
 * - `mpfInternal`: the `paletteNumber` field inside the `.mpf` file.
 * - `tileIndexPlus1`: `frameIndex + 1` (tileset tiles).
 * - `lowestKey`: the lowest key in the palette map (khan bodies).
 * - `dyeIndexZero`: a blank palette dyed with color-table entry 0 (khan pants).
 */
export type PaletteIdKind =
  | 'identifier'
  | 'identifierPlus1'
  | 'identifier3'
  | 'legendItem'
  | 'mpfInternal'
  | 'tileIndexPlus1'
  | 'lowestKey'
  | 'dyeIndexZero';

/**
 * The result of the pure rule-match stage.
 *
 * The `ruleId` is a stable identifier with the form `<archive>/<first prefix>`,
 * for example `legend/bkstory`, `setoa/lg_`, `khan/letter`, `hpf/sts`, `mpf/mns`.
 * Ports in other languages must emit identical strings — the shared conformance
 * fixture asserts on them.
 */
export interface PaletteRuleMatch {
  /** Stable rule identifier. */
  ruleId: string;
  kind: PaletteSourceKind;
  /** The archive that holds the palette data. `self` is the entry's own archive. */
  sourceArchive: 'self' | 'khanpal.dat' | 'legend.dat';
  /** `table` kind: the PaletteTable pattern (for example `itempal`). */
  tablePattern?: string;
  /** `table`/`indexed`/`constant`: the Palette pattern. `fixed`: the exact `.pal` entry name. */
  palettePattern?: string;
  /** `constant` kind: the hand-mapped palette number. */
  paletteNumber?: number;
  /** How to derive the palette id. Absent for `fixed` and `constant` kinds. */
  idKind?: PaletteIdKind;
  /** Khan letter rules: the male/female override to apply in the table lookup. */
  overrideType?: KhanPalOverrideType;
}

/** Build a `fixed` rule over one `.pal` entry in the entry's own archive. */
function fixedRule(ruleId: string, palName: string): PaletteRuleMatch {
  return { ruleId, kind: 'fixed', sourceArchive: 'self', palettePattern: palName };
}

// ---------------------------------------------------------------------------
// legend.dat — spec §2.1
// ---------------------------------------------------------------------------

interface LegendRow {
  prefixes: readonly string[];
  rule: PaletteRuleMatch;
}

// First match wins. The order copies the spec table; it is load-bearing.
const LEGEND_LADDER: readonly LegendRow[] = [
  { prefixes: ['bkstory'], rule: { ruleId: 'legend/bkstory', kind: 'indexed', sourceArchive: 'self', palettePattern: 'backpal', idKind: 'identifier' } },
  { prefixes: ['item'], rule: { ruleId: 'legend/item', kind: 'table', sourceArchive: 'self', tablePattern: 'itempal', palettePattern: 'item', idKind: 'legendItem' } },
  { prefixes: ['field'], rule: { ruleId: 'legend/field', kind: 'indexed', sourceArchive: 'self', palettePattern: 'field', idKind: 'identifier' } },
  { prefixes: ['skill', 'spell'], rule: fixedRule('legend/skill', 'legend01.pal') },
  { prefixes: ['line'], rule: fixedRule('legend/line', 'legend01.pal') },
  { prefixes: ['f0'], rule: fixedRule('legend/f0', 'legend.pal') },
  // The spec lists `line` in this row too, but the `line` row above already
  // matches it (spec §2.1 marks it dead). This row omits it.
  { prefixes: ['clock01', 'emo', 'mask', 'ms', 'question', 'rain', 'snow', 'woodbk'], rule: fixedRule('legend/clock01', 'legend01.pal') },
  { prefixes: ['staff'], rule: fixedRule('legend/staff', 'staff.pal') },
];

const LEGEND_DEFAULT: PaletteRuleMatch = fixedRule('legend/default', 'legend.pal');

function matchLegendRule(entry: string): PaletteRuleMatch {
  for (const row of LEGEND_LADDER) {
    if (row.prefixes.some(p => entry.startsWith(p))) return row.rule;
  }
  return LEGEND_DEFAULT;
}

// ---------------------------------------------------------------------------
// roh.dat — spec §2.1
// ---------------------------------------------------------------------------

function matchRohRule(entry: string): PaletteRuleMatch | null {
  if (entry.startsWith('efct')) {
    return { ruleId: 'roh/efct', kind: 'table', sourceArchive: 'self', tablePattern: 'effpal', palettePattern: 'eff', idKind: 'identifier' };
  }
  if (entry.startsWith('mefc')) {
    return { ruleId: 'roh/mefc', kind: 'table', sourceArchive: 'self', tablePattern: 'mefcpal', palettePattern: 'mefc', idKind: 'identifier' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// setoa.dat — spec §2.1
// ---------------------------------------------------------------------------

interface SetoaRow {
  prefixes: readonly string[];
  /** Also match these exact entry names, with extension. */
  exactNames?: readonly string[];
  guiNumber: number;
}

// Hand-mapped constant rules over the `gui*.pal` map. First match wins.
// The order copies the spec table; it is load-bearing (`dlgcre01` before
// `dlgcre`, `emot00` before `emot`, `lsbackm` before `lsback`, `setup12`
// before `setup`).
const SETOA_CONSTANT_LADDER: readonly SetoaRow[] = [
  { prefixes: ['dlgcre01'], guiNumber: 8 },
  { prefixes: ['gbicon02', 'mernum'], guiNumber: 0 },
  { prefixes: ['emot00', 'emotdlg'], guiNumber: 0 },
  { prefixes: ['lsbackm'], guiNumber: 0 },
  { prefixes: ['setup12', 'setup13', 'setup14'], guiNumber: 0 },
  { prefixes: ['gbicon12', 'orb'], guiNumber: 1 },
  { prefixes: ['gbicon01', 'gbicon03'], guiNumber: 2 },
  { prefixes: ['emot', 'equip02', 'mouse'], guiNumber: 3 },
  { prefixes: ['legends'], guiNumber: 3 },
  { prefixes: ['nation'], guiNumber: 5 },
  { prefixes: ['lback', 'dlgcre', 'lod0', 'setup'], guiNumber: 4 },
  { prefixes: ['skill0', 'spell0'], guiNumber: 6 },
  { prefixes: ['lodbk'], guiNumber: 7 },
  { prefixes: ['staff'], guiNumber: 9 },
  { prefixes: ['lsback', 'lss'], guiNumber: 10 },
  { prefixes: ['leicon'], guiNumber: 10 },
  { prefixes: ['ldi'], guiNumber: 11 },
  { prefixes: ['lwmap', 'tmapv'], guiNumber: 12 },
  { prefixes: ['bw_back', 'bw_check'], guiNumber: 13 },
  { prefixes: ['kdesc', 'key', 'khotkey'], guiNumber: 14 },
  { prefixes: ['lg_'], guiNumber: 15 },
  { prefixes: ['bw_flag'], guiNumber: 16 },
  { prefixes: ['album_b'], exactNames: ['album.epf'], guiNumber: 17 },
];

function setoaConstant(ruleId: string, guiNumber: number): PaletteRuleMatch {
  return { ruleId, kind: 'constant', sourceArchive: 'self', palettePattern: 'gui', paletteNumber: guiNumber };
}

function matchSetoaRule(entry: string): PaletteRuleMatch {
  if (entry.startsWith('field')) {
    return { ruleId: 'setoa/field', kind: 'indexed', sourceArchive: 'self', palettePattern: 'field', idKind: 'identifier' };
  }
  for (const row of SETOA_CONSTANT_LADDER) {
    const matches = row.prefixes.some(p => entry.startsWith(p)) || (row.exactNames?.includes(entry) ?? false);
    if (matches) return setoaConstant(`setoa/${row.prefixes[0]!}`, row.guiNumber);
  }
  return setoaConstant('setoa/default', 0);
}

// ---------------------------------------------------------------------------
// The khan family — spec §2.2
// ---------------------------------------------------------------------------

const KHAN_LETTER_REMAP: Readonly<Record<string, string>> = {
  a: 'b',
  g: 'c',
  j: 'c',
  o: 'm',
  s: 'p',
};

const KHAN_TABLE_LETTERS: ReadonlySet<string> = new Set(['b', 'c', 'e', 'f', 'h', 'i', 'l', 'p', 'u', 'w']);

function matchKhanRule(entry: string): PaletteRuleMatch | null {
  // The entry always ends with `.epf` here, so the second character exists.
  const raw = entry.charAt(1);
  const letter = KHAN_LETTER_REMAP[raw] ?? raw;

  if (letter === 'm') {
    // Bodies: the palette numbers are the in-game body-color values (spec §2.2 wart).
    // The resolver picks the lowest available `palm` number.
    return { ruleId: 'khan/body', kind: 'indexed', sourceArchive: 'khanpal.dat', palettePattern: 'palm', idKind: 'lowestKey' };
  }
  if (letter === 'n') {
    // Pants: the palettes are generated from `color0.tbl` dye entries (spec §2.5).
    // The resolver picks dye index 0.
    return { ruleId: 'khan/pants', kind: 'indexed', sourceArchive: 'legend.dat', idKind: 'dyeIndexZero' };
  }
  if (!KHAN_TABLE_LETTERS.has(letter)) return null;

  return {
    ruleId: 'khan/letter',
    kind: 'table',
    sourceArchive: 'khanpal.dat',
    tablePattern: `pal${letter}`,
    palettePattern: `pal${letter}`,
    idKind: 'identifier3',
    overrideType: entry.startsWith('m') ? KhanPalOverrideType.Male : KhanPalOverrideType.Female,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Match an `(archiveName, entryName)` pair against the palette resolution rules.
 * Pure string work — no archive access. All comparisons are case-insensitive.
 *
 * Returns `null` when no rule applies. Formats that carry their own color data
 * (`.spf`, `.efa`, `.pal`) never match (spec §2.6).
 */
export function matchPaletteRule(archiveName: string, entryName: string): PaletteRuleMatch | null {
  const archive = archiveName.toLowerCase();
  const entry = entryName.toLowerCase();

  // Tilesets — spec §2.5.
  if (entry === 'tilea.bmp') {
    return { ruleId: 'tileset/mpt', kind: 'table', sourceArchive: 'self', tablePattern: 'mptpal', palettePattern: 'mpt', idKind: 'tileIndexPlus1' };
  }
  if (entry === 'tileas.bmp') {
    return { ruleId: 'tileset/mps', kind: 'table', sourceArchive: 'self', tablePattern: 'mpspal', palettePattern: 'mps', idKind: 'tileIndexPlus1' };
  }

  // .mpf — spec §2.4. The id comes from inside the file.
  if (entry.endsWith('.mpf')) {
    return { ruleId: 'mpf/mns', kind: 'indexed', sourceArchive: 'self', palettePattern: 'mns', idKind: 'mpfInternal' };
  }

  // .hpf — spec §2.3.
  if (entry.endsWith('.hpf')) {
    if (entry.startsWith('stc')) {
      return { ruleId: 'hpf/stc', kind: 'table', sourceArchive: 'self', tablePattern: 'stcpal', palettePattern: 'stc', idKind: 'identifierPlus1' };
    }
    return { ruleId: 'hpf/sts', kind: 'table', sourceArchive: 'self', tablePattern: 'stspal', palettePattern: 'sts', idKind: 'identifierPlus1' };
  }

  // .epf — spec §2.1: dispatch by archive.
  if (!entry.endsWith('.epf')) return null;

  switch (archive) {
    case 'legend.dat':
      return matchLegendRule(entry);
    case 'national.dat':
      return { ruleId: 'national/legend', kind: 'fixed', sourceArchive: 'legend.dat', palettePattern: 'legend.pal' };
    case 'roh.dat':
      return matchRohRule(entry);
    case 'setoa.dat':
      return matchSetoaRule(entry);
    case 'misc.dat':
      return { ruleId: 'misc/legend', kind: 'fixed', sourceArchive: 'legend.dat', palettePattern: 'legend.pal' };
    default:
      if (archive.includes('khan')) return matchKhanRule(entry);
      return null;
  }
}
