// A small MCP client: servers are programs you configure; Eon talks to them over stdin/stdout (JSON-RPC, one
// message per line). Config: "servers" in .eon/mcp.json and ~/.eon/mcp.json:
//   {"servers": {"files": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]}}}
// The model sees only server names; it asks for a server's tool list, then one tool's description, then calls it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { redact } from './tools.js';

export function loadMcpConfig(root) {
  const servers = {};
  for (const file of [path.join(os.homedir(), '.eon', 'mcp.json'), path.join(root, '.eon', 'mcp.json')]) {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    for (const [name, s] of Object.entries(cfg.servers ?? {})) {
      if (/^[\w-]+$/.test(name) && typeof s?.command === 'string') servers[name] = { command: s.command, args: (s.args ?? []).map(String), env: s.env ?? {}, from: file.startsWith(root) ? 'project' : 'yours' };
    }
  }
  return servers;
}

export class McpServer {
  constructor(name, spec, { timeoutMs = 30000 } = {}) {
    Object.assign(this, { name, spec, timeoutMs, id: 0, pending: new Map(), buffer: '', tools: null, child: null, stderr: '' });
  }

  async start() {
    if (this.child) return;
    const win = process.platform === 'win32';
    const child = spawn(win ? shellQuote(this.spec.command) : this.spec.command, win ? (this.spec.args ?? []).map(shellQuote) : this.spec.args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...this.spec.env }, shell: win });
    this.child = child;
    child.stdout.on('data', (d) => this.#data(String(d)));
    child.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-2000); });
    child.on('error', (e) => this.#fail(new Error(`could not start ${this.spec.command}: ${e.message}`)));
    child.on('exit', () => { this.#fail(new Error(`${this.name} exited${this.stderr ? `: ${this.stderr.trim().slice(-300)}` : ''}`)); this.child = null; });
    await this.#request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'eon', version: '1' } });
    this.#send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  #fail(err) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); } this.pending.clear(); }

  #send(msg) { this.child?.stdin.write(`${JSON.stringify(msg)}\n`); }

  #data(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const p = this.pending.get(msg.id);
      if (!p) continue; // notifications and requests from the server are ignored
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? 'server error')); else p.resolve(msg.result);
    }
  }

  #request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${this.name} did not answer ${method} within ${this.timeoutMs / 1000}s`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      if (!this.child) { clearTimeout(timer); this.pending.delete(id); return reject(new Error(`${this.name} is not running`)); }
      this.#send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async listTools() {
    await this.start();
    this.tools ??= (await this.#request('tools/list', {})).tools ?? [];
    return this.tools;
  }

  async call(tool, args) {
    await this.listTools();
    if (!this.tools.some((t) => t.name === tool)) throw new Error(`${this.name} has no tool "${tool}". Tools: ${this.tools.map((t) => t.name).join(', ')}`);
    const r = await this.#request('tools/call', { name: tool, arguments: args ?? {} });
    const text = (r.content ?? []).map((c) => (c.type === 'text' ? c.text : `[${c.type} content not shown]`)).join('\n');
    return { text, isError: Boolean(r.isError) };
  }

  close() { try { this.child?.kill(); } catch { /* already gone */ } this.child = null; }
}

/** The servers of a session. Started only when the model asks for one and you have allowed it. */
/** For cmd.exe: wrap anything with a space or special character in quotes (paths such as C:\\Program Files\\nodejs). */
export const shellQuote = (t) => { const x = String(t); return /[\s"&|<>^()]/.test(x) && !/^".*"$/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };

export class McpHub {
  constructor(root) { this.root = root; this.config = loadMcpConfig(root); this.running = new Map(); }

  get names() { return Object.keys(this.config); }

  server(name) {
    if (!this.config[name]) throw new Error(`there is no MCP server "${name}". Configured: ${this.names.join(', ') || 'none'}`);
    if (!this.running.has(name)) this.running.set(name, new McpServer(name, this.config[name]));
    return this.running.get(name);
  }

  closeAll() { for (const s of this.running.values()) s.close(); this.running.clear(); }
}

export const capResult = (text, n = 6000) => {
  const t = redact(String(text));
  return t.length > n ? `${t.slice(0, n)}\n… ${t.length - n} more characters cut` : t;
};

// Ready-made entries for well-known servers (package names from the official MCP servers list; not run here).
export const PRESETS = {
  filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'], about: 'read and write files in this folder' },
  memory: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], about: 'a small knowledge graph the model can keep notes in' },
  'sequential-thinking': { command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'], about: 'step-by-step reasoning helper' },
  fetch: { command: 'uvx', args: ['mcp-server-fetch'], about: 'fetch a web page as text (needs uv)' },
  git: { command: 'uvx', args: ['mcp-server-git'], about: 'git status, log and diff as tools (needs uv)' },
};

const fileFor = (root, global) => (global ? path.join(os.homedir(), '.eon', 'mcp.json') : path.join(root, '.eon', 'mcp.json'));
const readCfg = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };

/** Save a server in .eon/mcp.json (or ~/.eon/mcp.json). Returns the file written. */
export function addMcpServer(root, { name, command, args = [], global = false }) {
  if (!/^[\w-]+$/.test(name)) throw new Error('A server name uses letters, digits, - and _ only.');
  if (!command) throw new Error('Give the command that starts the server, e.g. eon mcp add files npx -y @modelcontextprotocol/server-filesystem .');
  const file = fileFor(root, global), cfg = readCfg(file);
  cfg.servers = { ...(cfg.servers ?? {}), [name]: { command, args } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return file;
}

export function removeMcpServer(root, name) {
  for (const global of [false, true]) {
    const file = fileFor(root, global), cfg = readCfg(file);
    if (cfg.servers?.[name]) { delete cfg.servers[name]; fs.writeFileSync(file, JSON.stringify(cfg, null, 2)); return file; }
  }
  return null;
}
