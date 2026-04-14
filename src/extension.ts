import * as vscode from "vscode";
import { handleMessage } from "./utils/messageHandler";

// ─── File Store ─────────────────────────────────────────────

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

// ─── Drop Tree View ─────────────────────────────────────────

class DropTreeProvider
  implements
    vscode.TreeDataProvider<vscode.TreeItem>,
    vscode.TreeDragAndDropController<vscode.TreeItem>
{
  readonly dragMimeTypes: string[] = []; // 🔥 important
  readonly dropMimeTypes: string[] = ["text/uri-list"];

  constructor(private store: FileStore) {}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    return [new vscode.TreeItem("📂 Drop files here")];
  }

  async handleDrop(
    _target: vscode.TreeItem | undefined,
    dataTransfer: vscode.DataTransfer,
  ) {
    console.log("🎯 Drop triggered");

    const raw = dataTransfer.get("text/uri-list");

    if (!raw) {
      console.log("❌ No URI list found");
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

      // ✅ allow only .js and .css
      if (path.endsWith(".js") || path.endsWith(".css")) {
        valid.push(uri);
      } else {
        invalid.push(uri.fsPath);
      }
    }

    // ❌ Reject invalid files
    if (invalid.length) {
      vscode.window.showWarningMessage(
        `Only JS/CSS allowed. Ignored: ${invalid
          .map((p) => p.split(/[\\/]/).pop())
          .join(", ")}`,
      );
    }

    if (!valid.length) {
      console.log("⚠️ No valid files to add");
      return;
    }

    console.log("✅ Valid files:", valid.length);

    this.store.add(valid);
  }
}
// ─── Webview Provider ───────────────────────────────────────

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
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };

    view.webview.html = this.getHtml(view.webview);

    setTimeout(() => {
      const saved = this.context.globalState.get("convertConfig");

      console.log("📤 Sending restore:", saved);

      view.webview.postMessage({
        command: "restore",
        data: saved,
      });
    }, 500); // increase delay slightly

    view.webview.onDidReceiveMessage((msg) => {
      if (msg.type === "remove") {
        this.store.remove(msg.fsPath);
        return;
      }

      if (msg.type === "clear") {
        this.store.clear();
        return;
      }

      handleMessage(msg, view.webview, this.store, this.context);
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

  private getHtml(webview: vscode.Webview) {
    const htmlPath = vscode.Uri.joinPath(
      this.extensionUri,
      "media",
      "index.html",
    );

    let html = require("fs").readFileSync(htmlPath.fsPath, "utf-8");

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

// ─── Activate ───────────────────────────────────────────────

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
}

export function deactivate() {}
