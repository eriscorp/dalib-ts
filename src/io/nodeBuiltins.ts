/**
 * Node.js built-in modules for the Node-only code paths (fromFile, sync inflate/deflate).
 *
 * The ESM build has no `require`: tsup turns it into a shim that throws "Dynamic require of
 * ... is not supported". A static `import 'node:fs'` would break browser bundles. So each
 * accessor asks `process.getBuiltinModule` first (Node 20.16+ and 22.3+, both module systems),
 * and uses `require` only on an older Node, where only the CJS build can load the module.
 * In a browser both fail, and the accessor throws.
 */

type GetBuiltinModule = (id: string) => unknown;

function getBuiltin<T>(id: string): T | undefined {
  const proc = (globalThis as { process?: { getBuiltinModule?: GetBuiltinModule } }).process;
  return proc?.getBuiltinModule?.(id) as T | undefined;
}

export function nodeFs(): typeof import('fs') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return getBuiltin<typeof import('fs')>('node:fs') ?? (require('node:fs') as typeof import('fs'));
}

export function nodePath(): typeof import('path') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return getBuiltin<typeof import('path')>('node:path') ?? (require('node:path') as typeof import('path'));
}

export function nodeZlib(): typeof import('zlib') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return getBuiltin<typeof import('zlib')>('node:zlib') ?? (require('node:zlib') as typeof import('zlib'));
}
