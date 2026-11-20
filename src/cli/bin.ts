// HTOO-706. The CLI entry: `mcp` serves the MCP front on stdio; any other
// command runs the CLI. The published `dalib-ts` bin is this file, built by tsup.
import { resolve } from 'node:path';
import { main, parseArgs } from './cli.js';
import { serve } from './mcp.js';

const argv = process.argv.slice(2);
if (argv[0] === 'mcp') {
  const { flags } = parseArgs(argv.slice(1));
  const base = process.env.INIT_CWD ?? process.cwd();
  const client = typeof flags.client === 'string' ? resolve(base, flags.client) : process.env.DALIB_CLIENT_DIR;
  void serve(process.stdin, process.stdout, client ? { client } : {});
} else void main(argv);
