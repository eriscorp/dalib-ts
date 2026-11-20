import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { DataArchive } from '../data/DataArchive.js';
import type { ArchiveProvider } from '../drawing/PaletteResolver.js';

/**
 * The client folder and the archives a CLI command opens (HTOO-706).
 *
 * An archive is named as the client names it (`khanmad`, `khanmad.dat`) or by
 * a path. A name is matched against a listing of the folder with case folded:
 * the 7.41 installer writes `Legend.dat`, and every caller spells it lowercase.
 * A failed lookup is an error that names the folder, never an empty archive.
 */

/** A refusal the caller can act on. The CLI prints its message with no stack. */
export class CliError extends Error {}

export interface OpenArchive {
  /** The archive's file name as it is on disk, such as `Legend.dat`. */
  name: string;
  path: string;
  archive: DataArchive;
}

export interface CliContext {
  /** Where relative paths start: the folder the command was run from. */
  base: string;
  /** The client folder; throws when none was given. */
  clientDir(): string;
  /** The `.dat` files in the client folder, by lowercase name → real name. */
  datNames(): Map<string, string>;
  /** Open an archive by name or path; throws when it is not there. */
  open(nameOrPath: string): OpenArchive;
  /** Open a sibling archive by name, or null: the provider PaletteResolver takes. */
  provider: ArchiveProvider;
}

const looksLikePath = (s: string): boolean => /[\\/]/.test(s) || isAbsolute(s);

/** The number of entries in a `.dat`, from its header alone. */
export function entryCount(path: string): number {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(4);
    readSync(fd, head, 0, 4, 0);
    return Math.max(0, head.readInt32LE(0) - 1);
  } finally {
    closeSync(fd);
  }
}

export function createContext(options: { client?: string | undefined; base: string }): CliContext {
  let names: Map<string, string> | undefined;
  const opened = new Map<string, OpenArchive>();

  const clientDir = (): string => {
    if (!options.client) {
      throw new CliError('No client folder: pass --client <dir> or set DALIB_CLIENT_DIR');
    }
    const dir = resolve(options.base, options.client);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      throw new CliError(`The client folder ${dir} does not exist`);
    }
    return dir;
  };

  const datNames = (): Map<string, string> => {
    if (names === undefined) {
      names = new Map();
      for (const n of readdirSync(clientDir())) {
        if (n.toLowerCase().endsWith('.dat')) names.set(n.toLowerCase(), n);
      }
    }
    return names;
  };

  const resolvePath = (nameOrPath: string): { name: string; path: string } | null => {
    if (looksLikePath(nameOrPath)) {
      const path = resolve(options.base, nameOrPath);
      return existsSync(path) ? { name: basename(path), path } : null;
    }
    const lower = nameOrPath.toLowerCase();
    const key = lower.endsWith('.dat') ? lower : `${lower}.dat`;
    const real = datNames().get(key);
    return real === undefined ? null : { name: real, path: join(clientDir(), real) };
  };

  const open = (nameOrPath: string): OpenArchive => {
    const found = resolvePath(nameOrPath);
    if (!found) {
      const where = looksLikePath(nameOrPath) ? resolve(options.base, nameOrPath) : clientDir();
      throw new CliError(`No archive "${nameOrPath}" in ${where}`);
    }
    const cached = opened.get(found.path);
    if (cached) return cached;
    const entry = { ...found, archive: DataArchive.fromFile(found.path) };
    opened.set(found.path, entry);
    return entry;
  };

  const provider: ArchiveProvider = (name) => {
    try {
      return open(name).archive;
    } catch {
      return null;
    }
  };

  return { base: options.base, clientDir, datNames, open, provider };
}

/** True when `p` is the client folder or inside it. */
export function insideFolder(folder: string, p: string): boolean {
  const rel = relative(folder, p);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
