import * as vscode from "vscode";

export interface SelectOption {
  id: string;
  name: string;
}

export interface ActiveSelectionState {
  authMode: "apikey" | "oauth";
  apiKey?: string | null;
  accountId?: string;
  projectId?: string | null;
  projectName?: string;
  experienceId?: string | null;
  experienceName?: string;
  variationId?: string | null;
  variationName?: string;
}

export interface MpcServerStatusState {
  enabled: boolean;
  running: boolean;
  port?: number;
  endpoint?: string;
  healthUrl?: string;
  lastError?: string;
  configText?: string;
  updatedAt?: number;
}

const CONFIG_KEY = "convertConfig";
const MCP_STATE_KEY = "convertMcpState";

export class SessionStore {
  private selection: ActiveSelectionState = {
    authMode: "apikey",
  };

  private mcpState: MpcServerStatusState = {
    enabled: true,
    running: false,
  };

  private projectCache = new Map<string, SelectOption[]>();
  private experienceCache = new Map<string, SelectOption[]>();
  private variationCache = new Map<string, SelectOption[]>();
  private readonly selectionEmitter = new vscode.EventEmitter<ActiveSelectionState>();
  private readonly mcpEmitter = new vscode.EventEmitter<MpcServerStatusState>();

  readonly onDidChangeSelection = this.selectionEmitter.event;
  readonly onDidChangeMcpState = this.mcpEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.hydrate();
  }

  private hydrate() {
    const persistedSelection =
      this.context.globalState.get<ActiveSelectionState>(CONFIG_KEY) ?? {};
    const persistedMcp =
      this.context.globalState.get<MpcServerStatusState>(MCP_STATE_KEY) ?? {};

    this.selection = {
      authMode: "apikey",
      ...persistedSelection,
    };
    this.mcpState = {
      enabled: true,
      running: false,
      ...persistedMcp,
    };
  }

  getSelection(): ActiveSelectionState {
    return { ...this.selection };
  }

  async refreshSelectionFromStorage(): Promise<ActiveSelectionState> {
    const persisted =
      this.context.globalState.get<ActiveSelectionState>(CONFIG_KEY) ?? {};
    this.selection = {
      authMode: "apikey",
      ...persisted,
    };
    return this.getSelection();
  }

  async updateSelection(
    patch: Partial<ActiveSelectionState>,
    options?: { persist?: boolean; emit?: boolean },
  ) {
    this.selection = {
      ...this.selection,
      ...patch,
    };

    if (options?.persist !== false) {
      await this.context.globalState.update(CONFIG_KEY, this.selection);
    }

    if (options?.emit !== false) {
      this.selectionEmitter.fire(this.getSelection());
    }
  }

  getMcpState(): MpcServerStatusState {
    return { ...this.mcpState };
  }

  async updateMcpState(
    patch: Partial<MpcServerStatusState>,
    options?: { persist?: boolean; emit?: boolean },
  ) {
    this.mcpState = {
      ...this.mcpState,
      ...patch,
      updatedAt: Date.now(),
    };

    if (options?.persist !== false) {
      await this.context.globalState.update(MCP_STATE_KEY, this.mcpState);
    }

    if (options?.emit !== false) {
      this.mcpEmitter.fire(this.getMcpState());
    }
  }

  cacheProjects(accountId: string, items: SelectOption[]) {
    if (!accountId) {
      return;
    }

    this.projectCache.set(accountId, items);
  }

  getProjects(accountId: string): SelectOption[] {
    return [...(this.projectCache.get(accountId) ?? [])];
  }

  cacheExperiences(projectId: string, items: SelectOption[]) {
    if (!projectId) {
      return;
    }

    this.experienceCache.set(projectId, items);
  }

  getExperiences(projectId: string): SelectOption[] {
    return [...(this.experienceCache.get(projectId) ?? [])];
  }

  cacheVariations(experienceId: string, items: SelectOption[]) {
    if (!experienceId) {
      return;
    }

    this.variationCache.set(experienceId, items);
  }

  getVariations(experienceId: string): SelectOption[] {
    return [...(this.variationCache.get(experienceId) ?? [])];
  }
}
