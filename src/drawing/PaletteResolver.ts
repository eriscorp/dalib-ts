import { KhanPalOverrideType } from '../enums.js';
import type { DataArchive } from '../data/DataArchive.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { ColorTable } from './ColorTable.js';
import { Palette } from './Palette.js';
import { PaletteLookup } from './PaletteLookup.js';
import { matchPaletteRule, type PaletteRuleMatch, type PaletteSourceKind } from './paletteRules.js';
import { MpfView } from './virtualized/MpfView.js';

/**
 * Supplies sibling archives by file name (for example `khanpal.dat`).
 * Return `null` when the archive is not available. A `null` result is not an
 * error — the rules that need the sibling become unresolved.
 *
 * ## Names arrive lowercase; resolve them case-insensitively
 *
 * The rules name their sibling archives as lowercase literals, but the official
 * installer writes `Legend.dat` with a capital L. A provider that joins the name
 * straight onto a path therefore finds nothing on a case-sensitive filesystem,
 * and because `null` is a legitimate answer the failure is silent.
 *
 * Match names case-insensitively — list the directory once and fold. The
 * resolver retries {@link SIBLING_NAME_VARIANTS} on a `null`, which covers the
 * casings seen in the wild, but a provider that folds properly is the reliable
 * fix; the retry only guesses at names the library happens to know.
 */
export type ArchiveProvider = (name: string) => DataArchive | null;

/**
 * The resolved palette for an archive entry.
 */
export interface ResolvedPalette {
  palette: Palette;
  /** The real palette number, after any 1000 subtraction. 0 for `fixed` rules. */
  paletteNumber: number;
  /** True when the palette carries luminance alpha. Render with straight (non-premultiplied) alpha. */
  luminanceBlended: boolean;
  kind: PaletteSourceKind;
  /** The stable rule identifier, for example `setoa/lg_`. See {@link matchPaletteRule}. */
  ruleId: string;
}

/**
 * Palette stride between legend items. Observed in ChaosAssetManager, not
 * derived — presumed to be the item count per `.epf` (spec §8.2).
 */
const LEGEND_ITEM_PALETTE_STRIDE = 266;

/**
 * Casings to try for a sibling archive name, in order, until the provider
 * returns one.
 *
 * `legend.dat` as written by the rules, `Legend.dat` as written by the official
 * 7.41 installer, and `LEGEND.DAT` as written by some third-party unpackers.
 * Only names that differ from the one already tried are used, so a provider on a
 * case-insensitive filesystem is still called exactly once.
 */
const SIBLING_NAME_VARIANTS: readonly ((name: string) => string)[] = [
  (name) => name,
  (name) => name.charAt(0).toUpperCase() + name.slice(1),
  (name) => name.toUpperCase(),
  (name) => name.toLowerCase(),
];

/**
 * Resolves the palette for entries of one open archive.
 *
 * Create one instance per open archive and discard it when the archive closes.
 * The instance builds each palette source once, on first use, and caches it —
 * failed builds are cached too, so a missing sibling is not retried per call.
 *
 * `resolve` never throws. `null` means the entry is unresolved: no rule
 * matched, or a matched rule's data is missing. The host then falls back to a
 * manual palette picker.
 *
 * See the document repo: docs/architecture/palette-resolution.md.
 */
export class PaletteResolver {
  private readonly archiveName: string;
  private readonly archive: DataArchive;
  private readonly provider: ArchiveProvider;

  private readonly siblingCache = new Map<string, DataArchive | null>();
  private readonly lookupCache = new Map<string, PaletteLookup | null>();
  private readonly paletteMapCache = new Map<string, Map<number, Palette> | null>();
  private readonly fixedCache = new Map<string, Palette | null>();
  private dyedPantsPalette: Palette | null | undefined;

  /**
   * @param archiveName The file name of `archive` (for example `legend.dat`).
   *                    DataArchive does not record its own name.
   * @param archive     The open archive that holds the entries to resolve.
   * @param provider    Supplies sibling archives (`khanpal.dat`, `legend.dat`).
   */
  constructor(archiveName: string, archive: DataArchive, provider: ArchiveProvider) {
    this.archiveName = archiveName;
    this.archive = archive;
    this.provider = provider;
  }

  /**
   * Resolve the palette for an entry.
   *
   * `frameIndex` participates in exactly two rules: legend items (the frame
   * within the `.epf`) and tilesets (the tile index within `tilea.bmp` /
   * `tileas.bmp`). Every other rule ignores it.
   */
  resolve(entry: DataArchiveEntry, frameIndex = 0): ResolvedPalette | null {
    const match = matchPaletteRule(this.archiveName, entry.entryName);
    if (!match) return null;

    try {
      switch (match.kind) {
        case 'fixed':
          return this.resolveFixed(match);
        case 'constant':
          return this.resolveConstant(match);
        case 'indexed':
          return this.resolveIndexed(match, entry);
        case 'table':
          return this.resolveTable(match, entry, frameIndex);
      }
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Per-kind execution
  // ---------------------------------------------------------------------------

  private resolveFixed(match: PaletteRuleMatch): ResolvedPalette | null {
    const palette = this.getFixedPalette(match);
    if (!palette) return null;
    return { palette, paletteNumber: 0, luminanceBlended: false, kind: match.kind, ruleId: match.ruleId };
  }

  private resolveConstant(match: PaletteRuleMatch): ResolvedPalette | null {
    const map = this.getPaletteMap(match);
    const palette = map?.get(match.paletteNumber!);
    if (!palette) return null;
    return { palette, paletteNumber: match.paletteNumber!, luminanceBlended: false, kind: match.kind, ruleId: match.ruleId };
  }

  private resolveIndexed(match: PaletteRuleMatch, entry: DataArchiveEntry): ResolvedPalette | null {
    if (match.idKind === 'dyeIndexZero') {
      const palette = this.getDyedPantsPalette();
      if (!palette) return null;
      return { palette, paletteNumber: 0, luminanceBlended: false, kind: match.kind, ruleId: match.ruleId };
    }

    const map = this.getPaletteMap(match);
    if (!map) return null;

    let id: number | null;
    if (match.idKind === 'lowestKey') {
      id = null;
      for (const key of map.keys()) {
        if (id === null || key < id) id = key;
      }
    } else if (match.idKind === 'mpfInternal') {
      id = MpfView.fromEntry(entry).paletteNumber;
    } else {
      id = entry.tryGetNumericIdentifier();
    }
    if (id === null) return null;

    const palette = map.get(id);
    if (!palette) return null;
    return { palette, paletteNumber: id, luminanceBlended: false, kind: match.kind, ruleId: match.ruleId };
  }

  private resolveTable(match: PaletteRuleMatch, entry: DataArchiveEntry, frameIndex: number): ResolvedPalette | null {
    const lookup = this.getLookup(match);
    if (!lookup) return null;

    let id: number | null;
    switch (match.idKind) {
      case 'identifierPlus1': {
        const identifier = entry.tryGetNumericIdentifier();
        id = identifier === null ? null : identifier + 1;
        break;
      }
      case 'identifier3':
        id = entry.tryGetNumericIdentifier(3);
        break;
      case 'legendItem': {
        const identifier = entry.tryGetNumericIdentifier();
        id = identifier === null ? null : (identifier - 1) * LEGEND_ITEM_PALETTE_STRIDE + frameIndex + 1;
        break;
      }
      case 'tileIndexPlus1':
        id = frameIndex + 1;
        break;
      default:
        id = entry.tryGetNumericIdentifier();
    }
    if (id === null) return null;

    // An unmapped id yields palette number 0. When palette 0 exists, the entry
    // resolves to it — that is the client's real fallback, not an error.
    const result = lookup.getResolvedPaletteForId(id, match.overrideType ?? KhanPalOverrideType.None);
    return {
      palette: result.palette,
      paletteNumber: result.paletteNumber,
      luminanceBlended: result.luminanceBlended,
      kind: match.kind,
      ruleId: match.ruleId,
    };
  }

  // ---------------------------------------------------------------------------
  // Cached source builders
  // ---------------------------------------------------------------------------

  private getSourceArchive(match: PaletteRuleMatch): DataArchive | null {
    if (match.sourceArchive === 'self') return this.archive;
    return this.getSibling(match.sourceArchive);
  }

  /**
   * Fetch a sibling archive, tolerating the casing the host stores it under.
   *
   * Keyed on the requested name, not the one that answered, so the cache holds
   * one entry per rule literal and a miss is not re-probed per call.
   */
  private getSibling(name: string): DataArchive | null {
    let sibling = this.siblingCache.get(name);
    if (sibling === undefined) {
      sibling = null;
      const tried = new Set<string>();
      for (const variant of SIBLING_NAME_VARIANTS) {
        const candidate = variant(name);
        if (tried.has(candidate)) continue;
        tried.add(candidate);
        try {
          sibling = this.provider(candidate);
        } catch {
          sibling = null;
        }
        if (sibling) break;
      }
      this.siblingCache.set(name, sibling);
    }
    return sibling;
  }

  private sourceKey(match: PaletteRuleMatch): string {
    return `${match.sourceArchive}:${match.tablePattern ?? ''}|${match.palettePattern ?? ''}`;
  }

  private getLookup(match: PaletteRuleMatch): PaletteLookup | null {
    const key = this.sourceKey(match);
    let lookup = this.lookupCache.get(key);
    if (lookup === undefined) {
      lookup = null;
      const source = this.getSourceArchive(match);
      if (source) {
        try {
          lookup = PaletteLookup.fromArchivePatterns(match.tablePattern!, match.palettePattern!, source);
        } catch {
          lookup = null;
        }
      }
      this.lookupCache.set(key, lookup);
    }
    return lookup;
  }

  private getPaletteMap(match: PaletteRuleMatch): Map<number, Palette> | null {
    const key = this.sourceKey(match);
    let map = this.paletteMapCache.get(key);
    if (map === undefined) {
      map = null;
      const source = this.getSourceArchive(match);
      if (source) {
        try {
          map = Palette.fromArchive(match.palettePattern!, source);
          if (match.ruleId === 'setoa/field') {
            // Wart: a stray `fielde00.pal` parses to id 0 and shadows the real
            // `field000.pal`. Force the real file into slot 0, as CAM does
            // (RenderUtil.Setoa.cs:27-29). Do not change the identifier parser.
            const realFieldZero = source.get('field000.pal');
            if (realFieldZero) map.set(0, Palette.fromEntry(realFieldZero));
          }
        } catch {
          map = null;
        }
      }
      this.paletteMapCache.set(key, map);
    }
    return map;
  }

  private getFixedPalette(match: PaletteRuleMatch): Palette | null {
    const key = this.sourceKey(match);
    let palette = this.fixedCache.get(key);
    if (palette === undefined) {
      palette = null;
      const source = this.getSourceArchive(match);
      const entry = source?.get(match.palettePattern!);
      if (entry) {
        try {
          palette = Palette.fromEntry(entry);
        } catch {
          palette = null;
        }
      }
      this.fixedCache.set(key, palette);
    }
    return palette;
  }

  /**
   * Khan pants: dye a blank palette with entry 0 of `color0.tbl` from the
   * sibling `legend.dat` (spec §2.5). The host offers the other dye indices
   * through its manual picker — the reported `ruleId` identifies the rule.
   */
  private getDyedPantsPalette(): Palette | null {
    if (this.dyedPantsPalette === undefined) {
      this.dyedPantsPalette = null;
      const legend = this.getSibling('legend.dat');
      if (legend) {
        try {
          const colorTable = ColorTable.fromArchive('color0.tbl', legend);
          const dyeZero = colorTable.get(0);
          if (dyeZero) this.dyedPantsPalette = new Palette().dye(dyeZero);
        } catch {
          this.dyedPantsPalette = null;
        }
      }
    }
    return this.dyedPantsPalette;
  }
}
