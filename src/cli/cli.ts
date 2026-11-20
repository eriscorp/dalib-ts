// HTOO-706. `dalib-ts <command> …` (published) or `npm run -s dalib-ts -- <command> …`
// (a checkout): read Dark Ages client files headless. Each command prints one JSON
// object on stdout: `{ ok: true, command, result }`, or `{ ok: false, error }` with
// exit code 1 (2 for a usage error).
//
// The client folder is `--client`, else `DALIB_CLIENT_DIR`. Relative paths start
// where the command was run (`INIT_CWD` under npm). Nothing writes to the client.
import { CliError, createContext } from './context.js';
import * as cmd from './commands.js';
import type { McpContent, McpRunResult } from './agentMcp.js';

export const USAGE = `Usage: dalib-ts <command> [arguments] [--client <dir>] [--pretty] [--all]

  archives                                the client's .dat files, with entry counts
  ls <archive|*> [<pattern>]              entries by glob (*.epf) or prefix (mm), in one archive or every one
  cat <archive> <entry> [--hex] [--encoding <name>]
                                          a text entry (ASCII, else EUC-KR), or its bytes as hex
  info <archive> <entry|pattern>          frames, sizes, empty frames, animation header, palette rule
  render <archive> <entry> [--out <file.png>] [--frames 0,3-5] [--palette auto|<name.pal>|<archive>/<name.pal>]
         [--dye <n>] [--scale <n>] [--sheet <columns>] [--bg transparent|#rrggbb] [--max <px>]
                                          frames of an EPF, MPF, HPF, SPF or EFA as a PNG
  palette <archive> <entry> [--colors] [--frame <n>]
                                          the palette an entry resolves to (rule, number)
  palette-diff <archive>/<a.pal> <archive>/<b.pal>
                                          the indexes where two palettes differ
  tbl <archive> <entry> [--as color|cycling|palette]
                                          a colour, palette-cycling or palette lookup table
  map <file.map> --size <w>x<h> [--at x,y]
                                          distinct tile ids for each layer, or one tile
  map-diff <a.map> <b.map> --size <w>x<h> the cells where two maps differ
  sotp <id> ...                           the SOTP flags of static tile ids (ia.dat)
  extract <archive> <pattern> --out <dir> copies of the matching entries, outside the client folder

Lists are cut at ${cmd.LIST_LIMIT} items; --all gives them whole. A render over ${cmd.RENDER_LIMIT} px is refused unless --max allows it.`;

const BOOLEAN = new Set(['pretty', 'help', 'all', 'hex', 'colors', 'inline']);

export interface Parsed {
  positional: string[];
  flags: Record<string, string | true>;
}

class UsageError extends Error {}

/** `--name value` and `--name=value` flags, booleans from `BOOLEAN`, the rest positional. */
export function parseArgs(argv: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(2, eq) : a.slice(2);
    if (eq > 0) flags[name] = a.slice(eq + 1);
    else if (BOOLEAN.has(name)) flags[name] = true;
    else {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`--${name} needs a value`);
      flags[name] = v;
      i++;
    }
  }
  return { positional, flags };
}

const str = (flags: Parsed['flags'], name: string): string | undefined => {
  const v = flags[name];
  return typeof v === 'string' ? v : undefined;
};

function num(flags: Parsed['flags'], name: string): number | undefined {
  const v = str(flags, name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new UsageError(`--${name} must be a number`);
  return n;
}

function need(args: string[], n: number, what: string): void {
  if (args.length < n) throw new UsageError(what);
}

/**
 * Run one command line. Returns the object to print, the exit code, and for a
 * render with `--inline`, the PNG as MCP image content.
 */
export async function run(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<McpRunResult> {
  let p: Parsed;
  try {
    p = parseArgs(argv);
  } catch (e) {
    return { out: { ok: false, error: (e as Error).message, usage: USAGE }, code: 2 };
  }
  const [command, ...args] = p.positional;
  if (!command || p.flags.help) return { out: { ok: true, usage: USAGE }, code: command ? 0 : 2 };
  try {
    const f = p.flags;
    const all = f.all === true;
    const ctx = createContext({ client: str(f, 'client') ?? env.DALIB_CLIENT_DIR, base: env.INIT_CWD ?? process.cwd() });
    let result: unknown;
    let content: McpContent[] | undefined;
    switch (command) {
      case 'archives':
        result = cmd.archives(ctx);
        break;
      case 'ls':
        need(args, 1, 'ls needs an archive, or * for every archive');
        result = cmd.ls(ctx, args[0]!, args[1], all);
        break;
      case 'cat':
        need(args, 2, 'cat needs an archive and an entry');
        result = cmd.cat(ctx, args[0]!, args[1]!, { hex: f.hex === true, encoding: str(f, 'encoding') });
        break;
      case 'info':
        need(args, 2, 'info needs an archive and an entry or a pattern');
        result = cmd.info(ctx, args[0]!, args[1]!, all);
        break;
      case 'render': {
        need(args, 2, 'render needs an archive and an entry');
        const inline = f.inline === true;
        if (!inline && !str(f, 'out')) throw new UsageError('render needs --out <file.png>');
        const r = cmd.render(ctx, args[0]!, args[1]!, {
          out: str(f, 'out'),
          frames: str(f, 'frames'),
          palette: str(f, 'palette'),
          dye: num(f, 'dye'),
          scale: num(f, 'scale'),
          sheet: num(f, 'sheet'),
          bg: str(f, 'bg'),
          max: num(f, 'max'),
        });
        result = r.result;
        if (inline) content = [{ type: 'image', data: Buffer.from(r.png).toString('base64'), mimeType: 'image/png' }];
        break;
      }
      case 'palette':
        need(args, 2, 'palette needs an archive and an entry');
        result = cmd.palette(ctx, args[0]!, args[1]!, { colors: f.colors === true, frame: num(f, 'frame') });
        break;
      case 'palette-diff':
        need(args, 2, 'palette-diff needs two palettes, each <archive>/<name.pal>');
        result = cmd.paletteDiff(ctx, args[0]!, args[1]!);
        break;
      case 'tbl':
        need(args, 2, 'tbl needs an archive and an entry');
        result = cmd.tbl(ctx, args[0]!, args[1]!, str(f, 'as'), all);
        break;
      case 'map':
        need(args, 1, 'map needs a .map file');
        result = cmd.map(ctx, args[0]!, str(f, 'size'), { at: str(f, 'at'), all });
        break;
      case 'map-diff':
        need(args, 2, 'map-diff needs two .map files');
        result = cmd.mapDiff(ctx, args[0]!, args[1]!, str(f, 'size'), all);
        break;
      case 'sotp':
        need(args, 1, 'sotp needs at least one tile id');
        result = cmd.sotp(ctx, args);
        break;
      case 'extract':
        need(args, 2, 'extract needs an archive and a pattern');
        result = cmd.extract(ctx, args[0]!, args[1]!, str(f, 'out'));
        break;
      default:
        throw new UsageError(`No command "${command}"`);
    }
    const out = { ok: true, command, result };
    return content ? { out, code: 0, content } : { out, code: 0 };
  } catch (e) {
    if (e instanceof UsageError) return { out: { ok: false, error: e.message, usage: USAGE }, code: 2 };
    const known = e instanceof CliError;
    return { out: { ok: false, error: (e as Error).message, ...(known ? {} : { kind: (e as Error).name }) }, code: 1 };
  }
}

/** The entry: parse, run, print. Not run on import, so the tests call `run`. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { out, code } = await run(argv);
  const pretty = argv.includes('--pretty');
  process.stdout.write(JSON.stringify(out, null, pretty ? 2 : undefined) + '\n');
  process.exitCode = code;
}
