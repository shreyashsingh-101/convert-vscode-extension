import * as http from "http";
import * as vscode from "vscode";
import { getMcpTools, executeMcpTool } from "./tools";
import { SessionStore } from "../session/sessionStore";
import { getConvertApiDocsResource } from "./convertApiDocs";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcErrorShape {
  code: number;
  message: string;
}

const MCP_SERVER_NAME = "ABTest Extension";
const MCP_OUTPUT_NAME = `${MCP_SERVER_NAME} MCP`;

export class EmbeddedMcpServer {
  private server?: http.Server;
  private port?: number;
  private readonly output = vscode.window.createOutputChannel(MCP_OUTPUT_NAME);

  constructor(
    private readonly sessionStore: SessionStore,
    private readonly context: vscode.ExtensionContext,
  ) {}

  async start() {
    const state = this.sessionStore.getMcpState();
    if (state.enabled === false) {
      this.log("MCP server is disabled in state; skipping startup.");
      return;
    }

    if (this.server?.listening) {
      return;
    }

    const preferredPort = state.port && state.port > 0 ? state.port : 8765;
    const ports = [
      preferredPort,
      preferredPort + 1,
      preferredPort + 2,
      preferredPort + 3,
      preferredPort + 4,
      preferredPort + 5,
    ];

    for (const candidate of ports) {
      try {
        await this.listen(candidate);
        await this.sessionStore.updateMcpState({
          running: true,
          port: candidate,
          endpoint: `http://localhost:${candidate}/mcp`,
          healthUrl: `http://localhost:${candidate}/health`,
          lastError: "",
          configText: this.buildConfigText(candidate),
          healthStatus: "checking",
          transportOk: false,
          toolsOk: false,
          sessionToolOk: false,
          lastCheckError: "",
          enabled: true,
        });
        this.log(`MCP server started on port ${candidate}.`);
        await this.checkHealth();
        return;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.log(`Port ${candidate} unavailable: ${message}`);
      }
    }

    const lastError = "Unable to find a free local port for the MCP server.";
    await this.sessionStore.updateMcpState({
      running: false,
      lastError,
      enabled: true,
    });
    throw new Error(lastError);
  }

  async stop() {
    if (!this.server) {
      await this.sessionStore.updateMcpState({
        running: false,
      });
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    this.log("MCP server stopped.");
    this.server = undefined;
    this.port = undefined;
    await this.sessionStore.updateMcpState({
      running: false,
      healthStatus: "offline",
      transportOk: false,
      toolsOk: false,
      sessionToolOk: false,
    });
  }

  async restart() {
    await this.stop();
    await this.start();
  }

  dispose() {
    void this.stop();
    this.output.dispose();
  }

  getConfigText() {
    const state = this.sessionStore.getMcpState();
    return state.configText || this.buildConfigText(state.port ?? 8765);
  }

  async checkHealth() {
    const port = this.port ?? this.sessionStore.getMcpState().port;

    if (!port || !this.server?.listening) {
      await this.sessionStore.updateMcpState({
        running: false,
        healthStatus: "offline",
        transportOk: false,
        toolsOk: false,
        sessionToolOk: false,
        lastCheckError: "MCP server is not listening.",
        lastCheckedAt: Date.now(),
      });
      return this.sessionStore.getMcpState();
    }

    const endpoint = `http://localhost:${port}/mcp`;
    const healthUrl = `http://localhost:${port}/health`;

    await this.sessionStore.updateMcpState({
      healthStatus: "checking",
      lastCheckError: "",
      endpoint,
      healthUrl,
    });

    try {
      const healthResponse = await fetch(healthUrl);
      if (!healthResponse.ok) {
        throw new Error(`Health endpoint returned ${healthResponse.status}.`);
      }

      const toolsResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "tools",
          method: "tools/list",
        }),
      });

      if (!toolsResponse.ok) {
        throw new Error(`tools/list returned ${toolsResponse.status}.`);
      }

      const toolsPayload = (await toolsResponse.json()) as {
        result?: { tools?: unknown[] };
      };

      const sessionToolResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "session",
          method: "tools/call",
          params: {
            name: "get_active_session",
            arguments: {},
          },
        }),
      });

      if (!sessionToolResponse.ok) {
        throw new Error(`get_active_session returned ${sessionToolResponse.status}.`);
      }

      await sessionToolResponse.json();

      await this.sessionStore.updateMcpState({
        running: true,
        healthStatus: "healthy",
        transportOk: true,
        toolsOk: Array.isArray(toolsPayload.result?.tools),
        sessionToolOk: true,
        lastCheckError: "",
        lastCheckedAt: Date.now(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Health check failed: ${message}`);
      await this.sessionStore.updateMcpState({
        running: true,
        healthStatus: "degraded",
        transportOk: false,
        toolsOk: false,
        sessionToolOk: false,
        lastCheckError: message,
        lastCheckedAt: Date.now(),
      });
    }

    return this.sessionStore.getMcpState();
  }

  showLogs() {
    this.output.show(true);
  }

  private buildConfigText(port: number) {
    const endpoint = `http://localhost:${port}/mcp`;
    return JSON.stringify(
      {
        mcpServers: {
          [MCP_SERVER_NAME]: {
            url: endpoint,
          },
        },
      },
      null,
      2,
    );
  }

  private listen(port: number) {
    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });

    return new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(port, "0.0.0.0", () => {
        this.server?.off("error", reject);
        this.port = port;
        resolve();
      });
    });
  }

  private async handleRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ) {
    if (!this.isLocalRequest(request)) {
      this.writeJson(response, 403, {
        error: "Local connections only",
      });
      return;
    }

    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const requestUrl = request.url || "/";

    if (request.method === "GET" && requestUrl === "/health") {
      this.writeJson(response, 200, {
        ok: true,
        running: true,
        port: this.port,
      });
      return;
    }

    if (request.method === "GET" && requestUrl === "/config") {
      this.writeJson(response, 200, {
        endpoint: `http://localhost:${this.port}/mcp`,
        config: this.getConfigText(),
      });
      return;
    }

    if (request.method === "GET" && requestUrl === "/mcp") {
      this.writeJson(response, 405, {
        error: "SSE stream is not offered on this endpoint. Use HTTP POST for MCP requests.",
      });
      return;
    }

    if (request.method === "DELETE" && requestUrl === "/mcp") {
      this.writeJson(response, 405, {
        error: "Session termination is not supported by this server.",
      });
      return;
    }

    if (request.method !== "POST" || requestUrl !== "/mcp") {
      this.writeJson(response, 404, {
        error: "Not found",
      });
      return;
    }

    const rawBody = await this.readBody(request);
    let payload: JsonRpcRequest = {};

    try {
      payload = rawBody ? (JSON.parse(rawBody) as JsonRpcRequest) : {};
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`Request parse error: ${message}`);
      this.writeJson(response, 200, this.createRpcError(null, -32700, "Parse error"));
      return;
    }

    try {
      const result = await this.handleRpc(payload);
      this.writeJson(response, 200, result);
    } catch (error: unknown) {
      const rpcError = this.normalizeRpcError(error);
      this.log(`Request error: ${rpcError.message}`);
      this.writeJson(response, 200, this.createRpcError(payload.id ?? null, rpcError.code, rpcError.message));
    }
  }

  private async handleRpc(payload: JsonRpcRequest) {
    const method = payload.method || "";

    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id: payload.id ?? null,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
              resources: {},
            },
            serverInfo: {
              name: MCP_SERVER_NAME,
              version: this.context.extension.packageJSON.version,
            },
          },
        };

      case "notifications/initialized":
        return {
          jsonrpc: "2.0",
          id: payload.id ?? null,
          result: {},
        };

      case "ping":
        return {
          jsonrpc: "2.0",
          id: payload.id ?? null,
          result: {
            ok: true,
          },
        };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id: payload.id ?? null,
          result: {
            tools: getMcpTools(),
          },
        };

      case "prompts/list":
        return {
          jsonrpc: "2.0",
          id: payload.id ?? null,
          result: {
            prompts: [],
          },
        };

      case "resources/list":
        return {
          jsonrpc: "2.0",
          id: payload.id ?? null,
          result: {
            resources: [
              {
                uri: "convert://docs/api-v2",
                name: "Convert API v2 quick reference",
                description: "Built-in quick reference for the Convert API endpoints used by the extension.",
                mimeType: "text/markdown",
              },
            ],
          },
        };

      case "resources/templates/list":
        return {
          jsonrpc: "2.0",
          id: payload.id ?? null,
          result: {
            resourceTemplates: [],
          },
        };

      case "resources/read": {
        const uri = typeof payload.params?.uri === "string" ? payload.params.uri : "";
        if (uri !== "convert://docs/api-v2") {
          return {
            jsonrpc: "2.0",
            id: payload.id ?? null,
            error: {
              code: -32602,
              message: `Unknown resource: ${uri || "<empty>"}`,
            },
          };
        }

        return {
          jsonrpc: "2.0",
          id: payload.id ?? null,
          result: {
            contents: [
              {
                uri,
                mimeType: "text/markdown",
                text: getConvertApiDocsResource(),
              },
            ],
          },
        };
      }

      case "tools/call": {
        const toolName = typeof payload.params?.name === "string" ? payload.params.name : "";
        if (!toolName) {
          return this.createRpcError(payload.id ?? null, -32602, "Missing tool name.");
        }

        const args =
          payload.params && typeof payload.params.arguments === "object" && payload.params.arguments !== null
            ? (payload.params.arguments as Record<string, unknown>)
            : {};

        let toolResult: unknown;
        try {
          toolResult = await executeMcpTool(toolName, args);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.startsWith("Unknown MCP tool:")) {
            return this.createRpcError(payload.id ?? null, -32601, message);
          }

          throw error;
        }

        return {
          jsonrpc: "2.0",
          id: payload.id ?? null,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(toolResult ?? {}, null, 2),
              },
            ],
            structuredContent: toolResult ?? {},
          },
        };
      }

      default:
        return {
          jsonrpc: "2.0",
          id: payload.id ?? null,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        };
    }
  }

  private async readBody(request: http.IncomingMessage) {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString("utf-8");
  }

  private writeJson(
    response: http.ServerResponse,
    statusCode: number,
    body: Record<string, unknown>,
  ) {
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(body));
  }

  private log(message: string) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    this.output.appendLine(line);
  }

  private createRpcError(
    id: string | number | null,
    code: number,
    message: string,
  ) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    };
  }

  private normalizeRpcError(error: unknown): JsonRpcErrorShape {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && "message" in error
      && typeof (error as { code?: unknown }).code === "number"
      && typeof (error as { message?: unknown }).message === "string"
    ) {
      return error as JsonRpcErrorShape;
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      code: -32603,
      message,
    };
  }

  private isLocalRequest(request: http.IncomingMessage) {
    const remoteAddress = request.socket.remoteAddress || "";
    return (
      remoteAddress === "::1"
      || remoteAddress.startsWith("127.")
      || remoteAddress.startsWith("::ffff:127.")
    );
  }
}
