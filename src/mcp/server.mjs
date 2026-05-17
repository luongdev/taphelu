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
        serverInfo: { name: "taphelu", version: "0.0.0" },
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
  }

  start() {
    this.input.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      void this.readAvailableMessages();
    });
  }

  async readAvailableMessages() {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const header = this.buffer.subarray(0, headerEnd).toString("utf8");
      const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
      if (!lengthMatch) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }
      const contentLength = Number.parseInt(lengthMatch[1], 10);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (this.buffer.length < messageEnd) return;

      const body = this.buffer.subarray(messageStart, messageEnd).toString("utf8");
      this.buffer = this.buffer.subarray(messageEnd);
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        this.writeMessage(errorResponse(null, -32700, "Parse error."));
        continue;
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
  }

  writeMessage(message) {
    const json = JSON.stringify(message);
    this.output.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
  }
}
