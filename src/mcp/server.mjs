import { callTapheluTool, listTapheluTools } from "./tools.mjs";

export function startMcpServer({ input = process.stdin, output = process.stdout, cwd = process.cwd() } = {}) {
  const transport = new StdioJsonRpcTransport(input, output, async (message) => handleMcpMessage(message, cwd));
  transport.start();
  return transport;
}

export async function handleMcpMessage(message, cwd = process.cwd()) {
  const { id, method, params = {} } = message;
  if (!method) {
    return errorResponse(id, -32600, "Invalid request: missing method.");
  }

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: params.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "taphelu", version: "0.1.0" },
      },
    };
  }

  if (method === "notifications/initialized") {
    return null;
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: listTapheluTools() },
    };
  }

  if (method === "tools/call") {
    try {
      const result = callTapheluTool(params.name, params.arguments || {}, cwd);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
          structuredContent: result,
          isError: false,
        },
      };
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text: err instanceof Error ? err.message : String(err),
            },
          ],
          isError: true,
        },
      };
    }
  }

  if (method === "resources/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { resources: [] },
    };
  }

  if (method === "prompts/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { prompts: [] },
    };
  }

  if (method === "ping") {
    return {
      jsonrpc: "2.0",
      id,
      result: {},
    };
  }

  return errorResponse(id, -32601, `Method not found: ${method}`);
}

function errorResponse(id, code, message) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  };
}

class StdioJsonRpcTransport {
  constructor(input, output, handler) {
    this.input = input;
    this.output = output;
    this.handler = handler;
    this.buffer = Buffer.alloc(0);
    this.outputFraming = "headers";
  }

  start() {
    this.input.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      void this.readAvailableMessages();
    });
  }

  async readAvailableMessages() {
    while (true) {
      const envelope = this.readNextEnvelope();
      if (!envelope) return;
      this.outputFraming = envelope.framing;
      await this.handleEnvelope(envelope.body);
    }
  }

  readNextEnvelope() {
    this.dropLeadingWhitespace();
    if (this.buffer.length === 0) return null;

    if (this.buffer.subarray(0, 1).toString("utf8") === "{") {
      const lineEnd = this.buffer.indexOf("\n");
      if (lineEnd === -1) return null;
      const body = this.buffer.subarray(0, lineEnd).toString("utf8").trimEnd();
      this.buffer = this.buffer.subarray(lineEnd + 1);
      return { body, framing: "jsonl" };
    }

    const boundary = findHeaderBoundary(this.buffer);
    if (!boundary) return null;
    const header = this.buffer.subarray(0, boundary.index).toString("utf8");
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      this.buffer = this.buffer.subarray(boundary.index + boundary.length);
      return { body: null, framing: this.outputFraming };
    }
    const contentLength = Number.parseInt(lengthMatch[1], 10);
    const messageStart = boundary.index + boundary.length;
    const messageEnd = messageStart + contentLength;
    if (this.buffer.length < messageEnd) return null;

    const body = this.buffer.subarray(messageStart, messageEnd).toString("utf8");
    this.buffer = this.buffer.subarray(messageEnd);
    return { body, framing: "headers" };
  }

  dropLeadingWhitespace() {
    while (this.buffer.length > 0) {
      const first = this.buffer[0];
      if (first !== 10 && first !== 13 && first !== 32 && first !== 9) return;
      this.buffer = this.buffer.subarray(1);
    }
  }

  async handleEnvelope(body) {
    if (!body) return;
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      this.writeMessage(errorResponse(null, -32700, "Parse error."));
      return;
    }
    let response;
    try {
      response = await this.handler(parsed);
    } catch (error) {
      response = errorResponse(parsed.id, -32603, error instanceof Error ? error.message : "Internal error.");
    }
    if (response && parsed.id !== undefined) {
      this.writeMessage(response);
    }
  }

  writeMessage(message) {
    const json = JSON.stringify(message);
    if (this.outputFraming === "jsonl") {
      this.output.write(`${json}\n`);
      return;
    }
    this.output.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
  }
}

function findHeaderBoundary(buffer) {
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");
  if (crlf === -1 && lf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}
