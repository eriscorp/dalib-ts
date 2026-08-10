import { existsSync, readdirSync } from 'node:fs';

/**
 * Root of a real Dark Ages client installation, used by the tests that assert
 * against shipped assets rather than synthetic fixtures.
 *
 * Set `DALIB_CLIENT_DIR` to point at your own install. Set it to a path that does
 * not exist to force those tests to skip, which reproduces what CI does — useful
 * when calibrating the coverage floors, since a machine with the client reports
 * higher coverage than CI.
 */
export const CLIENT_DIR = process.env.DALIB_CLIENT_DIR ?? 'e:/games/dark ages';

/**
 * Real on-disk names in {@link CLIENT_DIR}, keyed by their lowercase form.
 *
 * The official 7.41 installer writes `Legend.dat` with a capital L while the
 * suites ask for `legend.dat`. Windows hid that for as long as the library was
 * developed there; on Linux `existsSync` returned false and the 15 tests in
 * `paletteResolver.test.ts` skipped with a real client installed and
 * `DALIB_CLIENT_DIR` set correctly. A skip for "no client" and a skip for "the
 * client is right there but one filename is capitalised" are indistinguishable
 * in the reporter, so the suite that would have caught the casing bug was the
 * suite the bug switched off.
 *
 * Built once. An unreadable or absent directory yields an empty map, which is
 * the no-client case and skips as before.
 */
let realNames: Map<string, string> | undefined;

function nameIndex(): Map<string, string> {
  if (realNames === undefined) {
    realNames = new Map();
    try {
      for (const name of readdirSync(CLIENT_DIR)) realNames.set(name.toLowerCase(), name);
    } catch {
      // No client installed, which is the CI case.
    }
  }
  return realNames;
}

/**
 * Absolute path to an archive inside the configured client directory, using the
 * casing the file actually has on disk.
 */
export function clientArchive(name: string): string {
  return `${CLIENT_DIR}/${nameIndex().get(name.toLowerCase()) ?? name}`;
}

/**
 * True when the named archive is present, whatever its casing, so a suite can
 * gate itself with `describe.skipIf(!hasClientArchive('ia.dat'))`. No client is
 * installed on CI, so those suites skip there and the repository commits no
 * binary assets.
 */
export function hasClientArchive(name: string): boolean {
  return nameIndex().has(name.toLowerCase()) || existsSync(`${CLIENT_DIR}/${name}`);
}
