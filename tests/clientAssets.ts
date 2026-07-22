import { existsSync } from 'node:fs';

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

/** Absolute path to an archive inside the configured client directory. */
export function clientArchive(name: string): string {
  return `${CLIENT_DIR}/${name}`;
}

/**
 * True when the named archive is present, so a suite can gate itself with
 * `describe.skipIf(!hasClientArchive('ia.dat'))`. No client is installed on CI,
 * so those suites skip there and the repository commits no binary assets.
 */
export function hasClientArchive(name: string): boolean {
  return existsSync(clientArchive(name));
}
