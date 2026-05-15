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
      name: "create_experiment",
      description: "Creates a Convert experiment using the same workflow as the extension wizard.",
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
          selectedLocations: { type: "array" },
          newLocations: { type: "array" },
          audiences: { type: "array" },
          goals: { type: "array" },
          newGoals: { type: "array" },
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
  ];
}

const commandMap: Record<string, string> = {
  get_active_session: "convert.getActiveSession",
  get_current_selection: "convert.getCurrentSelection",
  list_projects: "convert.listProjects",
  list_experiments: "convert.listExperiments",
  list_variations: "convert.listVariations",
  create_experiment: "convert.createExperiment",
  push_current_variation: "convert.pushCurrentVariation",
  push_global_code: "convert.pushGlobalCode",
  upload_images: "convert.uploadImages",
  open_editor: "convert.openEditor",
  sync_editor_files: "convert.syncEditorFiles",
  start_local_server: "convert.startLocalServer",
  run_preview_server: "convert.runPreviewServer",
  get_preview_link: "convert.getPreviewLink",
  copy_preview_link: "convert.copyPreviewLink",
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
