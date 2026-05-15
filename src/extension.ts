import * as vscode from "vscode";
import { readFileSync } from "fs";
import {
  handleEditorDocumentSave,
  handleMessage,
} from "./utils/messageHandler";
import {
  authenticate,
  clearToken,
  getClientId,
  getStoredAccounts,
  getToken,
} from "./auth/convertAuth";
import { CreateExperimentPanel } from "./panels/createExperiment/panel";
import { FileStore } from "./services/session/fileStore";
import {
  ActiveSelectionState,
  SessionStore,
} from "./services/session/sessionStore";
import { registerConvertCommands } from "./commands/convertCommands";
import { EmbeddedMcpServer } from "./services/mcp/server";

class DropTreeProvider
  implements
    vscode.TreeDataProvider<vscode.TreeItem>,
    vscode.TreeDragAndDropController<vscode.TreeItem>
{
  readonly dragMimeTypes: string[] = [];
  readonly dropMimeTypes: string[] = ["text/uri-list"];

  constructor(private store: FileStore) {}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    return [new vscode.TreeItem("Drop JS/CSS files here")];
  }

  async handleDrop(
    _target: vscode.TreeItem | undefined,
    dataTransfer: vscode.DataTransfer,
  ) {
    const raw = dataTransfer.get("text/uri-list");

    if (!raw) {
      return;
    }

    const uris = (raw.value as string)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => vscode.Uri.parse(s));

    const valid: vscode.Uri[] = [];
    const invalid: string[] = [];

    for (const uri of uris) {
      const path = uri.fsPath.toLowerCase();

      if (path.endsWith(".js") || path.endsWith(".css")) {
        valid.push(uri);
      } else {
        invalid.push(uri.fsPath);
      }
    }

    if (invalid.length) {
      vscode.window.showWarningMessage(
        `Only JS/CSS allowed. Ignored: ${invalid
          .map((p) => p.split(/[\\/]/).pop())
          .join(", ")}`,
      );
    }

    if (valid.length) {
      this.store.add(valid);
    }
  }
}

class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private extensionUri: vscode.Uri,
    private store: FileStore,
    private context: vscode.ExtensionContext,
    private sessionStore: SessionStore,
  ) {
    store.onChange((uris) => this.pushFiles(uris));
    sessionStore.onDidChangeSelection((selection) => {
      void this.pushSelection(selection);
    });
    sessionStore.onDidChangeMcpState((mcpState) => {
      void this.view?.webview.postMessage({
        command: "mcpStatus",
        data: mcpState,
      });
    });
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };

    view.webview.html = this.getHtml(view.webview);

    setTimeout(() => {
      void this.restoreState(view.webview);
    }, 100);

    view.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "remove") {
        this.store.remove(msg.fsPath);
        return;
      }

      if (msg.type === "clear") {
        this.store.clear();
        return;
      }

      void handleMessage(
        msg,
        view.webview,
        this.store,
        this.context,
        this.sessionStore,
      );
    });
  }

  private async pushSelection(selection: ActiveSelectionState) {
    await this.view?.webview.postMessage({
      command: "selectionSync",
      data: selection,
    });
  }

  private pushFiles(uris: vscode.Uri[]) {
    this.view?.webview.postMessage({
      type: "files",
      files: uris.map((u) => ({
        fsPath: u.fsPath,
        name: u.fsPath.split(/[\\/]/).pop(),
      })),
    });
  }

  private async restoreState(webview: vscode.Webview) {
    const saved = this.sessionStore.getSelection();
    const oauthToken = await getToken(this.context);
    const clientId = await getClientId(this.context);
    const storedAccounts = oauthToken
      ? await getStoredAccounts(this.context)
      : [];

    await webview.postMessage({
      command: "restore",
      data: {
        ...saved,
        authMode: oauthToken ? "oauth" : "apikey",
        clientId: clientId ?? "",
        accounts: storedAccounts.map((account) => ({
          id: String(account.account_id),
          name: account.name,
        })),
        mcp: this.sessionStore.getMcpState(),
      },
    });
  }

  openCreateExperiment(options: {
    accountId: string;
    projectId: string;
    projectName?: string;
    apiKey?: string;
  }) {
    if (!this.view) {
      vscode.window.showErrorMessage(
        "Open the Convert sidebar before creating an experiment.",
      );
      return;
    }

    CreateExperimentPanel.open(this.context, options, async (experiment) => {
      await this.view?.webview.postMessage({
        command: "experimentCreated",
        experiment,
        projectId: options.projectId,
      });
    });
  }

  private getHtml(webview: vscode.Webview) {
    const htmlPath = vscode.Uri.joinPath(
      this.extensionUri,
      "media",
      "index.html",
    );

    let html = readFileSync(htmlPath.fsPath, "utf-8");

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "script.js"),
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "styles.css"),
    );

    html = html.replace("{{scriptUri}}", scriptUri.toString());
    html = html.replace("{{styleUri}}", styleUri.toString());

    return html;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const store = new FileStore();
  const sessionStore = new SessionStore(context);
  const mcpServer = new EmbeddedMcpServer(sessionStore, context);
  const dropProvider = new DropTreeProvider(store);

  const treeView = vscode.window.createTreeView("convertDropZone", {
    treeDataProvider: dropProvider,
    dragAndDropController: dropProvider,
  });

  const sidebar = new SidebarProvider(
    context.extensionUri,
    store,
    context,
    sessionStore,
  );

  void mcpServer.start().catch(async (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    await sessionStore.updateMcpState({
      running: false,
      lastError: message,
    });
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("convertSidebar", sidebar, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
    treeView,
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      void handleEditorDocumentSave(document);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("convert.login", async () => {
      try {
        await authenticate(context);
        vscode.window.showInformationMessage("Connected to Convert!");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Login failed: ${message}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("convert.logout", async () => {
      await clearToken(context);
      vscode.window.showInformationMessage("Disconnected from Convert.");
      await sessionStore.updateSelection({
        authMode: "apikey",
      });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "convert.openCreateExperiment",
      (options: {
        accountId: string;
        projectId: string;
        projectName?: string;
        apiKey?: string;
      }) => {
        sidebar.openCreateExperiment(options);
      },
    ),
  );

  context.subscriptions.push(
    registerConvertCommands(context, {
      context,
      fileStore: store,
      sessionStore,
      getMcpConfigText: () => mcpServer.getConfigText(),
      restartMcpServer: () => mcpServer.restart(),
      showMcpLogs: () => mcpServer.showLogs(),
    }),
  );

  context.subscriptions.push({
    dispose: () => {
      mcpServer.dispose();
    },
  });
}

export function deactivate() {}
