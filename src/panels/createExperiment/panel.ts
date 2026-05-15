import * as vscode from "vscode";
import { getCreateExperimentHtml } from "./html";
import { handleCreateExperimentMessage } from "../../utils/messageHandler";

export interface CreateExperimentPanelOptions {
  accountId: string;
  projectId: string;
  projectName?: string;
  apiKey?: string;
}

export interface CreatedExperiment {
  id: string;
  name: string;
}

export class CreateExperimentPanel {
  private static currentPanel: CreateExperimentPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  static open(
    context: vscode.ExtensionContext,
    options: CreateExperimentPanelOptions,
    onCreated: (experiment: CreatedExperiment) => void | Promise<void>,
  ) {
    if (CreateExperimentPanel.currentPanel) {
      CreateExperimentPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
      CreateExperimentPanel.currentPanel.initialize(options);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "convertCreateExperiment",
      "Create Experiment",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(
            context.extensionUri,
            "src",
            "panels",
            "createExperiment",
          ),
        ],
      },
    );

    CreateExperimentPanel.currentPanel = new CreateExperimentPanel(
      panel,
      context,
      options,
      onCreated,
    );
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    private options: CreateExperimentPanelOptions,
    private readonly onCreated: (experiment: CreatedExperiment) => void | Promise<void>,
  ) {
    this.panel = panel;
    this.panel.webview.html = getCreateExperimentHtml(
      panel.webview,
      context.extensionUri,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message) => this.handleMessage(message as Record<string, unknown>),
      null,
      this.disposables,
    );

    this.initialize(options);
  }

  private initialize(options: CreateExperimentPanelOptions) {
    this.options = options;
    void this.panel.webview.postMessage({
      command: "initialize",
      data: {
        accountId: options.accountId,
        projectId: options.projectId,
        projectName: options.projectName,
      },
    });
  }

  private async handleMessage(message: Record<string, unknown>) {
    if (message.command === "ready") {
      this.initialize(this.options);
      return;
    }

    if (message.command === "closePanel") {
      this.panel.dispose();
      return;
    }

    await handleCreateExperimentMessage(
      {
        ...message,
        apiKey: this.options.apiKey,
        accountId: this.options.accountId,
        projectId: this.options.projectId,
      },
      this.panel.webview,
      this.context,
      async (experiment) => {
        await this.onCreated(experiment);
      },
    );
  }

  private dispose() {
    CreateExperimentPanel.currentPanel = undefined;

    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
