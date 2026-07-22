import { ControlType } from '../enums.js';
import type { DataArchive } from '../data/DataArchive.js';
import type { DataArchiveEntry } from '../data/DataArchiveEntry.js';
import { Control } from './Control.js';

/**
 * A parsed collection of UI Controls from a Dark Ages control text file (.txt).
 *
 * File format — tag-based text:
 *   <CONTROL>          — starts a control block
 *   <NAME> "name"      — name of the control (quoted)
 *   <TYPE> n           — ControlType integer
 *   <RECT> l t r b     — bounding rect
 *   <COLOR>            — begins color index list (subsequent bare lines are ints)
 *   <VALUE>            — begins return value (next bare line is the int)
 *   <IMAGE>            — begins image list (subsequent bare lines are '"name" frameIndex')
 *   <ENDCONTROL>       — ends control block
 */
export class ControlFile {
  /** All controls keyed by name (case-insensitive). */
  private readonly map: Map<string, Control> = new Map();
  readonly controls: Control[] = [];

  private add(control: Control): void {
    if (!control.name) return;
    if (this.map.has(control.name.toLowerCase())) return;
    this.controls.push(control);
    this.map.set(control.name.toLowerCase(), control);
  }

  /** Get a control by name (case-insensitive). */
  get(name: string): Control | undefined {
    return this.map.get(name.toLowerCase());
  }

  has(name: string): boolean {
    return this.map.has(name.toLowerCase());
  }

  // ---------------------------------------------------------------------------
  // Parsing
  // ---------------------------------------------------------------------------

  private static parseText(text: string): ControlFile {
    const file = new ControlFile();
    const lines = text.split(/\r?\n/);

    type TokenType = 'none' | 'color' | 'value' | 'image';

    let current: Control | null = null;
    let currentToken: TokenType = 'none';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const upper = line.toUpperCase();

      if (upper.startsWith('<CONTROL>')) {
        current = new Control();
        currentToken = 'none';
        continue;
      }

      if (upper.startsWith('<ENDCONTROL>')) {
        // <IMAGE> is an ordered list of (name, frame) entries — the image-button helper
        // consumes up to three as normal/hover/pressed. They are not a start/end range:
        // real layouts contain non-consecutive runs such as `_nemot.spf` 0, 1, 3, so
        // filling in the gaps would invent frames and shift the button states.
        if (current) file.add(current);
        current = null;
        currentToken = 'none';
        continue;
      }

      if (upper.startsWith('<NAME>')) {
        if (current) current.name = line.slice(8, -1); // strip <NAME> " and trailing "
        currentToken = 'none';
        continue;
      }

      if (upper.startsWith('<TYPE>')) {
        if (current) current.type = parseInt(line.slice(7), 10) as ControlType;
        currentToken = 'none';
        continue;
      }

      if (upper.startsWith('<RECT>')) {
        if (current) {
          const parts = line.slice(7).trim().split(/\s+/);
          if (parts.length === 4) {
            current.rect = {
              left: parseInt(parts[0]!, 10),
              top: parseInt(parts[1]!, 10),
              right: parseInt(parts[2]!, 10),
              bottom: parseInt(parts[3]!, 10),
            };
          }
        }
        currentToken = 'none';
        continue;
      }

      if (upper.startsWith('<COLOR>')) {
        if (current) current.colorIndexes = [];
        currentToken = 'color';
        continue;
      }

      if (upper.startsWith('<VALUE>')) {
        currentToken = 'value';
        continue;
      }

      if (upper.startsWith('<IMAGE>')) {
        if (current) current.images = [];
        currentToken = 'image';
        continue;
      }

      // Bare line — belongs to the current token
      if (!current) continue;

      switch (currentToken) {
        case 'color': {
          const n = parseInt(line, 10);
          if (!isNaN(n)) current.colorIndexes!.push(n);
          break;
        }
        case 'value': {
          const n = parseInt(line, 10);
          if (!isNaN(n)) current.returnValue = n;
          break;
        }
        case 'image': {
          const parts = line.match(/^"([^"]+)"\s+(\d+)$/);
          if (parts) {
            current.images!.push({ imageName: parts[1]!, frameIndex: parseInt(parts[2]!, 10) });
          }
          break;
        }
      }
    }

    return file;
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  static fromBuffer(buffer: ArrayBuffer | Uint8Array): ControlFile {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    return ControlFile.parseText(new TextDecoder().decode(bytes));
  }

  static fromEntry(entry: DataArchiveEntry): ControlFile {
    return ControlFile.fromBuffer(entry.toUint8Array());
  }

  /**
   * Loads all ControlFiles from the archive by parsing every .txt entry.
   * Entries that are not valid control files are silently skipped.
   * Returns a Map keyed by filename (without extension, lowercase).
   */
  static fromArchive(archive: DataArchive): Map<string, ControlFile> {
    const result = new Map<string, ControlFile>();

    for (const entry of archive.getEntriesByExtension('.txt')) {
      try {
        const name = entry.entryName.replace(/\.[^.]+$/, '').toLowerCase();
        result.set(name, ControlFile.fromEntry(entry));
      } catch {
        // not a valid control file — skip
      }
    }

    return result;
  }

  static fromFile(path: string): ControlFile {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('fs');
    const buf = fs.readFileSync(path);
    return ControlFile.fromBuffer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  }
}
