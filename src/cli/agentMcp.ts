/**
 * HOUSE MODULE — agent-mcp v1 (HTOO-705; first built as mabon WP107, HTOO-690).
 * Copied verbatim between the house apps and libraries that give an agent a
 * headless CLI (mabon, creidhne, dalib-ts). hyb-electron-template owns it:
 * change it here, then port it. It imports only Node built-ins.
 *
 * An MCP server over stdio: newline-delimited JSON-RPC 2.0, tools only. The app
 * gives the tools and its CLI's `run`. Each tool turns its arguments into the
 * CLI's argv and calls `run`, so the CLI and the MCP front cannot disagree.
 *
 * The arguments are checked against the tool's schema before the argv is
 * built. The argv is strings, so an unchecked `write: "false"` is a write, and
 * a text that starts with "--" is a flag (HTOO-702).
 */
import { createInterface } from 'readline'
import type { Readable, Writable } from 'stream'

export const MCP_PROTOCOL = '2025-06-18'

export interface McpProp {
  type: 'string' | 'number' | 'boolean' | 'array'
  description: string
  items?: { type: 'string' | 'number' }
}

export type McpProps = Record<string, McpProp>

export interface McpTool {
  name: string
  description: string
  properties: McpProps
  required?: string[]
  /** The CLI argv for a call's checked arguments, without the common flags. */
  argv: (args: Record<string, unknown>) => string[]
}

/** An MCP content item. A tool result holds the CLI's JSON as text, then any extra items. */
export type McpContent =
  { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

/** What the app's CLI returns for one argv. `content` adds items (an image) after the JSON. */
export interface McpRunResult {
  out: unknown
  code: number
  content?: McpContent[]
}

export interface McpServerSpec {
  /** The server name an MCP client shows, such as "mabon-map". */
  name: string
  version: string
  tools: McpTool[]
  /**
   * Flags every tool takes, such as `root`. A call's value wins over the
   * server's default. Each one that is set goes on the argv as `--name value`.
   */
  common?: McpProps
  run: (argv: string[]) => Promise<McpRunResult>
}

export type McpDefaults = Record<string, string | undefined>

export const stringProp = (description: string): McpProp => ({ type: 'string', description })
export const numberProp = (description: string): McpProp => ({ type: 'number', description })
export const booleanProp = (description: string): McpProp => ({ type: 'boolean', description })
export const stringsProp = (description: string): McpProp => ({
  type: 'array',
  items: { type: 'string' },
  description
})

/** `--name value` for each argument that is set; `--name` alone for `true`. */
export function flagArgs(args: Record<string, unknown>, names: string[]): string[] {
  const out: string[] = []
  for (const k of names) {
    const v = args[k]
    if (v === undefined || v === null || v === false) continue
    if (v === true) out.push(`--${k}`)
    else out.push(`--${k}`, String(v))
  }
  return out
}

/** A value as argv text; a missing value is "". */
export const argText = (v: unknown): string => String(v ?? '')

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * What is wrong with a call's arguments, or null. A value must have the type
 * its schema gives it, and a required one must be there. null counts as left
 * out. A text must not start with "--", or the argv would read it as a flag. A
 * name the schema does not have is ignored, as the argv never reads it.
 */
export function argumentError(tool: McpTool, args: unknown, common: McpProps = {}): string | null {
  if (!isObject(args)) return 'the arguments must be an object'
  for (const name of tool.required ?? []) {
    if (args[name] === undefined || args[name] === null) return `"${name}" is required`
  }
  for (const [name, prop] of Object.entries({ ...tool.properties, ...common })) {
    const v = args[name]
    if (v === undefined || v === null) continue
    if (prop.type === 'array') {
      if (!Array.isArray(v) || v.some((item) => typeof item !== prop.items?.type))
        return `"${name}" must be an array of ${prop.items?.type ?? 'value'}s`
    } else if (prop.type === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) return `"${name}" must be a number`
    } else if (typeof v !== prop.type) {
      return `"${name}" must be a ${prop.type}`
    }
    const texts = Array.isArray(v) ? v : [v]
    if (texts.some((t) => typeof t === 'string' && t.startsWith('--')))
      return `"${name}" must not start with "--"`
  }
  return null
}

/** The `tools/list` result: each tool with an object schema, the common flags last. */
export function listTools(spec: McpServerSpec): unknown[] {
  return spec.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: {
      type: 'object',
      properties: { ...t.properties, ...(spec.common ?? {}) },
      ...(t.required ? { required: t.required } : {})
    }
  }))
}

export interface McpRequest {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: Record<string, unknown>
}

type Reply = Record<string, unknown>

/** One JSON-RPC message gives the reply, or null for a notification. */
export async function handleMcp(
  spec: McpServerSpec,
  msg: McpRequest,
  defaults: McpDefaults = {}
): Promise<Reply | null> {
  if (!isObject(msg)) {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }
  }
  const reply = (result: unknown): Reply => ({ jsonrpc: '2.0', id: msg.id ?? null, result })
  const fail = (code: number, message: string): Reply => ({
    jsonrpc: '2.0',
    id: msg.id ?? null,
    error: { code, message }
  })
  if (msg.id === undefined) return null // a notification, such as notifications/initialized
  if (typeof msg.method !== 'string') return fail(-32600, 'Invalid Request')
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: MCP_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name: spec.name, version: spec.version }
      })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: listTools(spec) })
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      const tool = spec.tools.find((t) => t.name === name)
      if (!tool) return fail(-32602, `No tool "${name}"`)
      const args = msg.params?.arguments ?? {}
      const wrong = argumentError(tool, args, spec.common)
      if (wrong) {
        const text = JSON.stringify({ error: `${name}: ${wrong}` })
        return reply({ content: [{ type: 'text', text }], isError: true })
      }
      const a = args as Record<string, unknown>
      const common: string[] = []
      for (const key of Object.keys(spec.common ?? {})) {
        const v = a[key] ?? defaults[key]
        if (v !== undefined && v !== null && v !== '') common.push(`--${key}`, String(v))
      }
      const { out, code, content = [] } = await spec.run([...tool.argv(a), ...common])
      return reply({
        content: [{ type: 'text', text: JSON.stringify(out) }, ...content],
        isError: code !== 0
      })
    }
    default:
      return fail(-32601, `No method "${msg.method}"`)
  }
}

/** Serve MCP on a pair of streams until the input ends. */
export async function serveMcp(
  spec: McpServerSpec,
  input: Readable,
  output: Writable,
  defaults: McpDefaults = {}
): Promise<void> {
  const lines = createInterface({ input, crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.trim()) continue
    let msg: McpRequest
    try {
      msg = JSON.parse(line) as McpRequest
    } catch {
      const parseError = {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' }
      }
      output.write(JSON.stringify(parseError) + '\n')
      continue
    }
    let res: Reply | null
    try {
      res = await handleMcp(spec, msg, defaults)
    } catch (e) {
      // One bad message must not end the server for the calls after it.
      const id = isObject(msg) ? msg.id : undefined
      if (id === undefined) continue
      const message = e instanceof Error ? e.message : String(e)
      res = { jsonrpc: '2.0', id, error: { code: -32603, message } }
    }
    if (res) output.write(JSON.stringify(res) + '\n')
  }
}
