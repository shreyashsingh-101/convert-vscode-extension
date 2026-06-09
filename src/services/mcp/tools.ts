import * as vscode from "vscode";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function getMcpTools(): McpToolDefinition[] {
  return [
    {
      name: "get_active_session",
      description: "Returns the current active Convert selection from the extension state.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_current_selection",
      description: "Alias for get_active_session.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "set_active_selection",
      description: "Updates the extension's active account, project, experiment, and variation selection.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          projectName: { type: "string" },
          experienceId: { type: "string" },
          experienceName: { type: "string" },
          variationId: { type: "string" },
          variationName: { type: "string" },
        },
      },
    },
    {
      name: "list_projects",
      description: "Lists Convert projects for an account, using the current extension selection by default.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          search: { type: "string" },
        },
      },
    },
    {
      name: "list_experiments",
      description: "Lists Convert experiments for a project, using current extension state when possible.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          search: { type: "string" },
        },
      },
    },
    {
      name: "list_experiences",
      description: "Alias for list_experiments.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          search: { type: "string" },
        },
      },
    },
    {
      name: "list_variations",
      description: "Lists variations for the selected experiment.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          experienceId: { type: "string" },
        },
      },
    },
    {
      name: "list_locations",
      description: "Lists project locations with optional Convert-side search.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          search: { type: "string" },
        },
      },
    },
    {
      name: "list_audiences",
      description: "Lists project audiences with optional Convert-side search.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          search: { type: "string" },
        },
      },
    },
    {
      name: "list_goals",
      description: "Lists project goals with optional Convert-side search.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          search: { type: "string" },
        },
      },
    },
    {
      name: "create_experiment",
      description: "Creates a Convert experiment using the same workflow as the extension wizard. Original is created automatically; provide variationNames to create named non-baseline variations at creation time.",
      inputSchema: {
        type: "object",
        required: ["name", "url"],
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          name: { type: "string" },
          url: { type: "string" },
          description: { type: "string" },
          audienceName: { type: "string" },
          audienceNames: { type: "array", items: { type: "string" } },
          selectAllGoals: { type: "boolean" },
          includePreviewLink: { type: "boolean" },
          returnPreviewLink: { type: "boolean" },
          variationNames: { type: "array", items: { type: "string" } },
          additionalVariationNames: { type: "array", items: { type: "string" } },
          selectedLocations: { type: "array" },
          newLocations: { type: "array" },
          audiences: { type: "array" },
          goals: { type: "array" },
          newGoals: { type: "array" },
        },
      },
    },
    {
      name: "get_experiment_details",
      description: "Returns details for a specific Convert experiment.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          experienceId: { type: "string" },
        },
      },
    },
    {
      name: "create_location",
      description: "Creates a Convert location from a raw API-style payload.",
      inputSchema: {
        type: "object",
        required: ["payload"],
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          payload: { type: "object" },
        },
      },
    },
    {
      name: "create_goal",
      description: "Creates a Convert goal from a raw API-style payload.",
      inputSchema: {
        type: "object",
        required: ["payload"],
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          payload: { type: "object" },
        },
      },
    },
    {
      name: "push_current_variation",
      description: "Pushes the currently selected variation code using provided file paths or the extension drop zone.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          experienceId: { type: "string" },
          variationId: { type: "string" },
          filePaths: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "push_global_code",
      description: "Pushes global JS/CSS to the selected experiment.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          experienceId: { type: "string" },
          filePaths: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "upload_images",
      description: "Uploads one or more images to the selected Convert project.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          imagePaths: { type: "array", items: { type: "string" } },
          imageNames: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      name: "open_editor",
      description: "Opens local editor files for the selected variation or global code.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          experienceId: { type: "string" },
          variationId: { type: "string" },
        },
      },
    },
    {
      name: "sync_editor_files",
      description: "Pushes the current editor file contents back to Convert.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          experienceId: { type: "string" },
          variationId: { type: "string" },
        },
      },
    },
    {
      name: "start_local_server",
      description: "Starts the local preview server using a provided saved-config-style object.",
      inputSchema: {
        type: "object",
        properties: {
          config: { type: "object" },
        },
      },
    },
    {
      name: "run_preview_server",
      description: "Alias for start_local_server.",
      inputSchema: {
        type: "object",
        properties: {
          config: { type: "object" },
        },
      },
    },
    {
      name: "get_preview_link",
      description: "Returns a Convert preview link for the selected variation.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          experienceId: { type: "string" },
          variationId: { type: "string" },
        },
      },
    },
    {
      name: "copy_preview_link",
      description: "Copies a Convert preview link for the selected variation to the clipboard.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          projectId: { type: "string" },
          experienceId: { type: "string" },
          variationId: { type: "string" },
        },
      },
    },
    {
      name: "get_mcp_config",
      description: "Returns the embedded MCP server config block for localhost usage.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "check_mcp_health",
      description: "Runs a live self-check against the embedded MCP server transport and core tools.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "restart_mcp_server",
      description: "Restarts the embedded MCP server.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "show_mcp_logs",
      description: "Opens the embedded MCP server log output in VS Code.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_convert_api_overview",
      description: "Returns a local overview of Convert API areas and official docs root.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "search_convert_api_docs",
      description: "Searches the built-in Convert API reference index and returns matching endpoints plus the official docs root.",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
        },
      },
    },
    {
      name: "call_convert_api",
      description: "Calls a Convert API v2 account-scoped endpoint directly. Restricted to /accounts/... paths on api.convert.com. Accepts either body or payload for the request body.",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: {
          method: { type: "string", enum: ["GET", "POST", "PUT", "DELETE"] },
          path: { type: "string" },
          body: { type: "object" },
          payload: { type: "object" },
          apiKey: { type: "string" },
        },
      },
    },
  ];
}

const commandMap: Record<string, string> = {
  get_active_session: "convert.getActiveSession",
  get_current_selection: "convert.getCurrentSelection",
  set_active_selection: "convert.setActiveSelection",
  list_projects: "convert.listProjects",
  list_experiments: "convert.listExperiments",
  list_experiences: "convert.listExperiments",
  list_locations: "convert.listLocations",
  list_audiences: "convert.listAudiences",
  list_goals: "convert.listGoals",
  list_variations: "convert.listVariations",
  get_experiment_details: "convert.getExperimentDetails",
  create_experiment: "convert.createExperiment",
  create_location: "convert.createLocation",
  create_goal: "convert.createGoal",
  push_current_variation: "convert.pushCurrentVariation",
  push_global_code: "convert.pushGlobalCode",
  upload_images: "convert.uploadImages",
  open_editor: "convert.openEditor",
  sync_editor_files: "convert.syncEditorFiles",
  start_local_server: "convert.startLocalServer",
  run_preview_server: "convert.runPreviewServer",
  get_preview_link: "convert.getPreviewLink",
  copy_preview_link: "convert.copyPreviewLink",
  get_mcp_config: "convert.getMcpConfig",
  check_mcp_health: "convert.checkMcpHealth",
  restart_mcp_server: "convert.restartMcpServer",
  show_mcp_logs: "convert.showMcpLogs",
  get_convert_api_overview: "convert.getConvertApiOverview",
  search_convert_api_docs: "convert.searchConvertApiDocs",
  call_convert_api: "convert.callConvertApi",
};

export async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>,
) {
  const command = commandMap[toolName];

  if (!command) {
    throw new Error(`Unknown MCP tool: ${toolName}`);
  }

  return vscode.commands.executeCommand(command, args);
}
