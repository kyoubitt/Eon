// A tiny MCP server over stdio, for tests. Tools: echo, big (a huge result), fail (isError), hang (never answers).
import readline from 'node:readline';
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const TOOLS = [
  { name: 'echo', description: 'Echo a message back.\nSecond line.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'big', description: 'A very long result', inputSchema: { type: 'object' } },
  { name: 'fail', description: 'Always errors', inputSchema: { type: 'object' } },
  { name: 'hang', description: 'Never answers', inputSchema: { type: 'object' } },
];
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } });
  else if (m.method === 'tools/call') {
    const { name, arguments: args } = m.params;
    if (name === 'echo') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `echo: ${args.text}` }] } });
    else if (name === 'big') send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'x'.repeat(50000) + ' API_KEY=sk-supersecret-123456789' }] } });
    else if (name === 'fail') send({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'it broke' }] } });
    // hang: no answer
  }
});
