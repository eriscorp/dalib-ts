// The house module's own tests (hyb-electron-template,
// src/main/agentMcp/__tests__/agentMcp.test.ts), with the imports pointed at
// this copy. The template also runs them against its JS edition; dalib-ts
// has only the TypeScript, so the edition list here has one entry.
import { PassThrough } from 'stream'
import { describe, expect, it } from 'vitest'
import * as tsEdition from '../../src/cli/agentMcp.js'
import {
  booleanProp,
  flagArgs,
  numberProp,
  stringProp,
  stringsProp,
  type McpRequest,
  type McpServerSpec
} from '../../src/cli/agentMcp.js'

// A fake CLI: it echoes the argv, fails on "boom", throws on "throw", and
// adds an image for "picture".
const spec: McpServerSpec = {
  name: 'sample-agent',
  version: '1',
  common: { root: stringProp('The workspace') },
  tools: [
    {
      name: 'echo',
      description: 'Echo the argv',
      properties: {
        words: stringsProp('The words'),
        count: numberProp('A number'),
        write: booleanProp('Write the change')
      },
      required: ['words'],
      argv: (a) => ['echo', ...(a.words as string[]), ...flagArgs(a, ['count', 'write'])]
    },
    {
      name: 'status',
      description: 'Set a status',
      properties: { status: stringProp('The status'), clear: booleanProp('Remove it') },
      argv: (a) => [
        'status',
        ...(a.status === undefined ? [] : [String(a.status)]),
        ...flagArgs(a, ['clear'])
      ]
    }
  ],
  run: async (argv) => {
    if (argv.includes('throw')) throw new Error('the CLI threw')
    if (argv.includes('boom')) return { out: { ok: false, error: 'boom' }, code: 1 }
    const content = argv.includes('picture')
      ? [{ type: 'image' as const, data: 'iVBORw0KGgo=', mimeType: 'image/png' }]
      : undefined
    return { out: { ok: true, argv }, code: 0, content }
  }
}

type Out = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// Both editions run every test: the JS edition is what a JS app (creidhne) copies.
describe.each([
  ['the TypeScript', tsEdition as typeof tsEdition]
])('agent-mcp v1, %s', (_edition, mod) => {
  const rpc = async (
    method: string,
    params?: Record<string, unknown>,
    id: number | null = 1,
    defaults = {}
  ): Promise<Out> =>
    (await mod.handleMcp(
      spec,
      { jsonrpc: '2.0', ...(id === null ? {} : { id }), method, params } as McpRequest,
      defaults
    )) as Out

  const callTool = async (name: string, args: unknown, defaults = {}): Promise<Out> => {
    const res = await rpc('tools/call', { name, arguments: args }, 1, defaults)
    return { isError: res.result.isError, out: JSON.parse(res.result.content[0].text), res }
  }

  it('answers initialize with the tools capability and the server name', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} })
    expect(init.result.capabilities).toEqual({ tools: {} })
    expect(init.result.serverInfo).toEqual({ name: 'sample-agent', version: '1' })
    expect((await rpc('ping')).result).toEqual({})
  })

  it('gives no reply to a notification', async () => {
    expect(await rpc('notifications/initialized', undefined, null)).toBeNull()
  })

  it('lists each tool with an object schema, the common flags last', async () => {
    const { result } = await rpc('tools/list')
    expect(result.tools.map((t: Out) => t.name)).toEqual(['echo', 'status'])
    const echo = result.tools[0]
    expect(echo.inputSchema.type).toBe('object')
    expect(echo.inputSchema.required).toEqual(['words'])
    expect(Object.keys(echo.inputSchema.properties)).toEqual(['words', 'count', 'write', 'root'])
    expect(result.tools[1].inputSchema.required).toBeUndefined()
  })

  it('builds the argv, calls run, and returns its JSON as text', async () => {
    const res = await callTool('echo', { words: ['a', 'b'], count: 3, write: true })
    expect(res.isError).toBe(false)
    expect(res.out.argv).toEqual(['echo', 'a', 'b', '--count', '3', '--write'])
  })

  it('leaves out a false or missing boolean', async () => {
    for (const args of [{ write: false }, {}, { write: null }]) {
      const res = await callTool('echo', { words: ['a'], ...args })
      expect(res.out.argv).toEqual(['echo', 'a'])
    }
  })

  it("adds a common flag from the server's default, and a call's value wins", async () => {
    expect((await callTool('echo', { words: ['a'] }, { root: '/w' })).out.argv).toEqual([
      'echo',
      'a',
      '--root',
      '/w'
    ])
    expect((await callTool('echo', { words: ['a'], root: '/x' }, { root: '/w' })).out.argv).toEqual(
      ['echo', 'a', '--root', '/x']
    )
    expect((await callTool('echo', { words: ['a'] })).out.argv).toEqual(['echo', 'a'])
  })

  it('appends the extra content items that run returns', async () => {
    const res = await callTool('echo', { words: ['picture'] })
    expect(res.res.result.content).toHaveLength(2)
    expect(res.res.result.content[1]).toEqual({
      type: 'image',
      data: 'iVBORw0KGgo=',
      mimeType: 'image/png'
    })
  })

  it('marks a call that fails isError', async () => {
    const res = await callTool('echo', { words: ['boom'] })
    expect(res.isError).toBe(true)
    expect(res.out.error).toBe('boom')
  })

  it('refuses an unknown tool and an unknown method', async () => {
    expect((await rpc('tools/call', { name: 'fly' })).error.code).toBe(-32602)
    expect((await rpc('resources/list')).error.code).toBe(-32601)
  })

  // HTOO-702: the argv is strings, so an unchecked "false" would be a write.
  it.each(['false', 'true', 0, 1, 'no', ''])(
    'refuses write: %j, which is not a boolean',
    async (write) => {
      const res = await callTool('echo', { words: ['a'], write })
      expect(res.isError).toBe(true)
      expect(res.out.error).toBe('echo: "write" must be a boolean')
    }
  )

  it('refuses a text that starts with "--", which the argv would read as a flag', async () => {
    expect((await callTool('status', { status: '--clear' })).out.error).toBe(
      'status: "status" must not start with "--"'
    )
    expect((await callTool('echo', { words: ['a', '--root=elsewhere'] })).out.error).toBe(
      'echo: "words" must not start with "--"'
    )
    expect((await callTool('echo', { words: ['a'], root: '--x' })).out.error).toBe(
      'echo: "root" must not start with "--"'
    )
    expect((await callTool('status', { status: 'a--b' })).isError).toBe(false)
  })

  it('refuses a wrong type, a missing required argument, and arguments that are not an object', async () => {
    const error = async (name: string, args: unknown): Promise<string> => {
      const res = await callTool(name, args)
      expect(res.isError).toBe(true)
      return res.out.error
    }
    expect(await error('echo', { words: 'a' })).toBe('echo: "words" must be an array of strings')
    expect(await error('echo', { words: ['a', 5] })).toBe(
      'echo: "words" must be an array of strings'
    )
    expect(await error('echo', { words: ['a'], count: '3' })).toBe('echo: "count" must be a number')
    expect(await error('echo', { words: ['a'], count: Infinity })).toBe(
      'echo: "count" must be a number'
    )
    expect(await error('status', { status: 5 })).toBe('status: "status" must be a string')
    expect(await error('echo', { words: ['a'], root: 5 })).toBe('echo: "root" must be a string')
    expect(await error('echo', {})).toBe('echo: "words" is required')
    expect(await error('echo', true)).toBe('echo: the arguments must be an object')
    expect(await error('echo', ['a'])).toBe('echo: the arguments must be an object')
  })

  it('argumentError ignores a name the schema does not have', () => {
    expect(mod.argumentError(spec.tools[0], { words: ['a'], other: 5 })).toBeNull()
  })

  it('serves newline-delimited JSON-RPC on streams, and keeps serving after bad input', async () => {
    const input = new PassThrough()
    const output = new PassThrough()
    let text = ''
    output.on('data', (d) => (text += d))
    const done = mod.serveMcp(spec, input, output, { root: '/w' })
    input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n')
    input.write('not json\n')
    input.write('\n')
    input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    input.write(
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"words":["throw"]}}}\n'
    )
    input.end(
      '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"echo","arguments":{"words":["x"]}}}\n'
    )
    await done
    const replies = text
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(replies.map((r) => r.id)).toEqual([1, null, 2, 3])
    expect(replies[1].error.code).toBe(-32700)
    expect(replies[2].error).toEqual({ code: -32603, message: 'the CLI threw' })
    expect(JSON.parse(replies[3].result.content[0].text).argv).toEqual([
      'echo',
      'x',
      '--root',
      '/w'
    ])
  })
})
