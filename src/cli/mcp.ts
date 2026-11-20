// HTOO-706. The client-asset CLI as an MCP server, on the agent-mcp v1 house
// module (agentMcp.ts, copied from hyb-electron-template). Each tool builds the
// CLI's argv and calls `run`. dalib_render adds --inline, so the PNG comes back
// as image content the agent can see.
//
// Start it with `dalib-ts mcp --client <dir>`.
import type { Readable, Writable } from 'node:stream';
import {
  argText,
  booleanProp,
  flagArgs,
  handleMcp,
  numberProp,
  serveMcp,
  stringProp,
  stringsProp,
  type McpDefaults,
  type McpRequest,
  type McpServerSpec,
  type McpTool,
} from './agentMcp.js';
import { run } from './cli.js';

const ARCHIVE = stringProp('An archive in the client folder (khanmad, Legend.dat) or a path to a .dat');
const ENTRY = stringProp('An entry name, such as mm001.epf');
const ALL = booleanProp('Give every list whole (lists are cut at 50 items)');

export const TOOLS: McpTool[] = [
  {
    name: 'dalib_archives',
    description: "The client folder's .dat files, with entry counts and sizes.",
    properties: {},
    argv: () => ['archives'],
  },
  {
    name: 'dalib_ls',
    description: 'Entries matching a glob (*.epf) or a prefix (mm), in one archive, or in every archive when archive is "*".',
    properties: { archive: stringProp('An archive, or "*" for every archive'), pattern: stringProp('A glob or a prefix'), all: ALL },
    required: ['archive'],
    argv: (a) => ['ls', argText(a.archive), ...(a.pattern === undefined || a.pattern === null ? [] : [argText(a.pattern)]), ...flagArgs(a, ['all'])],
  },
  {
    name: 'dalib_cat',
    description: 'A text entry (ASCII, else EUC-KR) as a string, or its bytes as hex.',
    properties: {
      archive: ARCHIVE,
      entry: ENTRY,
      hex: booleanProp('Give the bytes as hex (the first 4096)'),
      encoding: stringProp('A TextDecoder encoding, such as euc-kr'),
    },
    required: ['archive', 'entry'],
    argv: (a) => ['cat', argText(a.archive), argText(a.entry), ...flagArgs(a, ['hex', 'encoding'])],
  },
  {
    name: 'dalib_info',
    description:
      "What the library reads in an entry: size, frame count, each frame's rect, empty frames, an MPF's animation header, and the palette rule. With a glob, one row per entry.",
    properties: { archive: ARCHIVE, entry: stringProp('An entry name, or a glob such as *.epf'), all: ALL },
    required: ['archive', 'entry'],
    argv: (a) => ['info', argText(a.archive), argText(a.entry), ...flagArgs(a, ['all'])],
  },
  {
    name: 'dalib_render',
    description:
      'Render frames of an EPF, MPF, HPF, SPF or EFA entry, or tiles of a ground tileset (tilea.bmp, tileas.bmp in seo.dat), and return the PNG as an image. The palette resolves by the client rules unless one is named. sheet lays several frames out in that many columns. A render over 1024 px is refused unless max allows it.',
    properties: {
      archive: ARCHIVE,
      entry: ENTRY,
      frames: stringProp('Frame indexes and ranges, such as "0,3-5". Default: frame 0, or every frame with sheet'),
      tiles: stringProp('For a tileset: ground tile ids as a map holds them, such as "1,3-5"; 1 is the first tile. Default: tile 1'),
      palette: stringProp('"auto" (default), a .pal in the same archive, or <archive>/<name.pal>'),
      dye: numberProp('A dye index from color0.tbl'),
      scale: numberProp('A whole-number scale, 1 to 16'),
      sheet: numberProp('Columns for a contact sheet'),
      bg: stringProp('"transparent" (default) or #rrggbb'),
      max: numberProp('The largest side allowed, in pixels'),
      out: stringProp('Also write the PNG to this path'),
    },
    required: ['archive', 'entry'],
    argv: (a) => [
      'render',
      argText(a.archive),
      argText(a.entry),
      '--inline',
      ...flagArgs(a, ['frames', 'tiles', 'palette', 'dye', 'scale', 'sheet', 'bg', 'max', 'out']),
    ],
  },
  {
    name: 'dalib_palette',
    description: 'The palette an entry resolves to by the client rules: rule id, kind, palette number, and the 256 colours on request.',
    properties: {
      archive: ARCHIVE,
      entry: ENTRY,
      colors: booleanProp('Give the 256 colours'),
      frame: numberProp('The frame, for rules that vary by frame'),
      tile: numberProp('For a tileset: the ground tile id as a map holds it; 1 is the first tile'),
    },
    required: ['archive', 'entry'],
    argv: (a) => ['palette', argText(a.archive), argText(a.entry), ...flagArgs(a, ['colors', 'frame', 'tile'])],
  },
  {
    name: 'dalib_palette_diff',
    description: 'The indexes where two palettes differ, each named <archive>/<name.pal>.',
    properties: { first: stringProp('<archive>/<name.pal>'), second: stringProp('<archive>/<name.pal>') },
    required: ['first', 'second'],
    argv: (a) => ['palette-diff', argText(a.first), argText(a.second)],
  },
  {
    name: 'dalib_tbl',
    description: 'A table entry: a colour table (color*.tbl), a palette-cycling table (<n>.tbl) or a palette lookup table.',
    properties: { archive: ARCHIVE, entry: ENTRY, as: stringProp('"color", "cycling" or "palette"; by default from the name'), all: ALL },
    required: ['archive', 'entry'],
    argv: (a) => ['tbl', argText(a.archive), argText(a.entry), ...flagArgs(a, ['as', 'all'])],
  },
  {
    name: 'dalib_map',
    description: "A map file's distinct tile ids for each layer (background, left and right foreground) with counts, or the tile at one point. A map file does not hold its size.",
    properties: {
      file: stringProp('The .map file'),
      size: stringProp('<width>x<height>'),
      at: stringProp('x,y for one tile'),
      all: ALL,
    },
    required: ['file', 'size'],
    argv: (a) => ['map', argText(a.file), ...flagArgs(a, ['size', 'at', 'all'])],
  },
  {
    name: 'dalib_map_diff',
    description: 'The cells where two maps of one size differ.',
    properties: { first: stringProp('A .map file'), second: stringProp('A .map file'), size: stringProp('<width>x<height>'), all: ALL },
    required: ['first', 'second', 'size'],
    argv: (a) => ['map-diff', argText(a.first), argText(a.second), ...flagArgs(a, ['size', 'all'])],
  },
  {
    name: 'dalib_sotp',
    description: 'The SOTP flags of static tile ids: collision, render flags, over the player, and the directions each blocks.',
    properties: { ids: stringsProp('Static tile ids') },
    required: ['ids'],
    argv: (a) => ['sotp', ...((a.ids as string[] | undefined) ?? [])],
  },
  {
    name: 'dalib_extract',
    description: 'Write copies of the matching entries to a folder outside the client folder.',
    properties: { archive: ARCHIVE, pattern: stringProp('A glob or a prefix'), out: stringProp('The folder to write to') },
    required: ['archive', 'pattern', 'out'],
    argv: (a) => ['extract', argText(a.archive), argText(a.pattern), ...flagArgs(a, ['out'])],
  },
];

export const SPEC: McpServerSpec = {
  name: 'dalib-ts',
  version: '1',
  tools: TOOLS,
  common: { client: stringProp("The Dark Ages client folder. Default: the server's --client") },
  run: (argv) => run(argv),
};

export const handle = (msg: McpRequest, defaults: McpDefaults = {}) => handleMcp(SPEC, msg, defaults);
export const serve = (input: Readable, output: Writable, defaults: McpDefaults = {}) => serveMcp(SPEC, input, output, defaults);
