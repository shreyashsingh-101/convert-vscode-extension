import * as vscode from "vscode";
import { readFileSync } from "fs";
import { handleMessage } from "./utils/messageHandler";
import {
  authenticate,
  clearToken,
  getClientId,
  getStoredAccounts,
  getToken,
} from "./auth/convertAuth";

interface ConvertConfig {
  apiKey?: string | null;
  accountId?: string;
  projectId?: string | null;
  experienceId?: string | null;
  variationId?: string | null;
  authMode?: "apikey" | "oauth";
}

class FileStore {
  private files: vscode.Uri[] = [];
  private listeners: ((uris: vscode.Uri[]) => void)[] = [];

  add(uris: vscode.Uri[]) {
    const existing = new Set(this.files.map((f) => f.fsPath));
    const newUris = uris.filter((u) => !existing.has(u.fsPath));
    this.files.push(...newUris);
    this.notify();
  }

  remove(fsPath: string) {
    this.files = this.files.filter((f) => f.fsPath !== fsPath);
    this.notify();
  }

  clear() {
    this.files = [];
    this.notify();
  }

  getAll(): vscode.Uri[] {
    return [...this.files];
  }

  onChange(cb: (uris: vscode.Uri[]) => void) {
    this.listeners.push(cb);
  }

  private notify() {
    this.listeners.forEach((cb) => cb([...this.files]));
  }
}

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
  ) {
    store.onChange((uris) => this.pushFiles(uris));
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

      void handleMessage(msg, view.webview, this.store, this.context);
    });

    this.pushFiles(this.store.getAll());
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
    const saved =
      this.context.globalState.get<ConvertConfig>("convertConfig") ?? {};
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
      },
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
  const dropProvider = new DropTreeProvider(store);

  const treeView = vscode.window.createTreeView("convertDropZone", {
    treeDataProvider: dropProvider,
    dragAndDropController: dropProvider,
  });

  const sidebar = new SidebarProvider(context.extensionUri, store, context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("convertSidebar", sidebar, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
    treeView,
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
    }),
  );
}

export function deactivate() {}
