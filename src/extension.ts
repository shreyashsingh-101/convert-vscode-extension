import * as vscode from "vscode";
import { handleMessage } from "./utils/messageHandler";

// ─── Shared State ────────────────────────────────────────────────────────────

class FileStore {
  private files: vscode.Uri[] = [];
  private listeners: ((uris: vscode.Uri[]) => void)[] = [];

  add(uris: vscode.Uri[]) {
    const existing = new Set(this.files.map(f => f.fsPath));
    const newUris = uris.filter(u => !existing.has(u.fsPath));
    console.log("➕ Adding files to store:", newUris.length);
    this.files.push(...newUris);
    this.notify();
  }

  remove(fsPath: string) {
    console.log("➖ Removing file from store:", fsPath);
    this.files = this.files.filter(f => f.fsPath !== fsPath);
    this.notify();
  }

  clear() {
    console.log("🗑️ Clearing store");
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
    console.log("🔔 Store changed, notifying", this.listeners.length, "listeners");
    this.listeners.forEach(cb => cb([...this.files]));
  }
}

// ─── Tree View (Drop Target) ────────────────────────────────────────────

class DropTreeProvider
  implements
    vscode.TreeDataProvider<vscode.TreeItem>,
    vscode.TreeDragAndDropController<vscode.TreeItem>
{
  readonly dragMimeTypes: string[] = [];
  readonly dropMimeTypes = ["text/uri-list"];

  getTreeItem(el: vscode.TreeItem) {
    return el;
  }

  getChildren() {
    return [];
  }

  constructor(private readonly store: FileStore) {}

  async handleDrop(
    _target: vscode.TreeItem | undefined,
    dataTransfer: vscode.DataTransfer
  ): Promise<void> {
    console.log("🎯 Drop received in tree view");
    const raw = dataTransfer.get("text/uri-list");
    if (!raw) {
      console.log("❌ No text/uri-list in drop");
      return;
    }

    const uris = (raw.value as string)
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => vscode.Uri.parse(s));

    console.log("📂 Parsed URIs from drop:", uris.length);
    this.store.add(uris);
  }
}

// ─── Webview (Main UI) ─────────────────────────────────────────────────────

class SidebarWebviewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: FileStore
  ) {
    // Whenever store changes, push update to webview
    store.onChange(uris => this.pushFiles(uris));
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    // Handle messages FROM the webview
    webviewView.webview.onDidReceiveMessage((msg) => {
      console.log("📨 Webview message:", msg.type);
      switch (msg.type) {
        case "remove":
          this.store.remove(msg.fsPath);
          break;
        case "clear":
          this.store.clear();
          break;
        case "process":
          this.processFiles();
          break;
        default:
          handleMessage(msg, webviewView.webview, this.store);
      }
    });

    // Send initial files
    this.pushFiles(this.store.getAll());
  }

  private pushFiles(uris: vscode.Uri[]) {
    console.log("📤 Pushing files to webview:", uris.length);
    this.view?.webview.postMessage({
      type: "files",
      files: uris.map(u => ({
        fsPath: u.fsPath,
        name: u.fsPath.split(/[\\/]/).pop()
      }))
    });
  }

  private async processFiles() {
    const paths = this.store.getAll().map(u => u.fsPath);
    if (!paths.length) {
      vscode.window.showWarningMessage("No files added.");
      return;
    }

    // Read and process files
    for (const path of paths) {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.file(path)
      );
      const text = Buffer.from(bytes).toString("utf-8");
      console.log(`[${path}]:\n`, text);
    }

    vscode.window.showInformationMessage(
      `Processed ${paths.length} file(s).`
    );
  }

  private getHtml() {
    return /* html */`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }

          body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            padding: 12px;
            display: flex;
            flex-direction: column;
            height: 100vh;
            gap: 10px;
          }

          h2 { font-size: 16px; margin-bottom: 8px; }

          .section {
            margin-bottom: 10px;
          }

          .section label {
            display: block;
            font-size: 12px;
            margin-bottom: 4px;
            font-weight: 600;
          }

          .section input {
            width: 100%;
            padding: 6px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-size: 12px;
          }

          .files-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
          }

          .files-header h3 {
            font-size: 13px;
            margin: 0;
          }

          .hint {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            text-align: center;
            padding: 16px 8px;
            border: 1px dashed var(--vscode-panel-border);
            border-radius: 4px;
            display: none;
          }

          .hint.visible {
            display: block;
          }

          #file-list {
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 4px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 3px;
            padding: 4px;
            background: var(--vscode-editor-background);
            min-height: 100px;
            max-height: 200px;
          }

          .file-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 8px;
            background: var(--vscode-list-inactiveSelectionBackground);
            border-radius: 3px;
            font-size: 12px;
            gap: 6px;
          }

          .file-item:hover {
            background: var(--vscode-list-hoverBackground);
          }

          .file-name {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-weight: 500;
          }

          .file-path {
            color: var(--vscode-descriptionForeground);
            font-size: 10px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 200px;
          }

          .remove-btn {
            background: none;
            border: none;
            color: var(--vscode-icon-foreground);
            cursor: pointer;
            padding: 2px 4px;
            border-radius: 2px;
            opacity: 0.6;
            font-size: 14px;
          }

          .remove-btn:hover {
            opacity: 1;
            background: var(--vscode-toolbar-hoverBackground);
          }

          .actions {
            display: flex;
            gap: 6px;
            margin-top: auto;
          }

          button.action {
            flex: 1;
            padding: 6px;
            border: none;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
          }

          button.action:hover {
            background: var(--vscode-button-secondaryHoverBackground);
          }

          button.action.primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
          }

          button.action.primary:hover {
            background: var(--vscode-button-hoverBackground);
          }

          .dropdown {
            padding: 6px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-size: 12px;
          }

          .dropdown select {
            width: 100%;
            padding: 4px;
            border: none;
            background: transparent;
            color: inherit;
            font-size: 12px;
            cursor: pointer;
          }
        </style>
      </head>
      <body>
        <h2>Convert VSCode Extension</h2>

        <!-- API Configuration -->
        <div class="section">
          <label for="apiKey">API Key</label>
          <input id="apiKey" placeholder="Enter API_Key:API_Secret" />
        </div>

        <div class="section">
          <label for="accountId">Account ID</label>
          <input id="accountId" placeholder="Enter Account ID" />
        </div>

        <div class="section">
          <button onclick="loadProjects()" style="width: 100%; padding: 8px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">Load Projects</button>
        </div>

        <div class="section">
          <label for="projects">Projects</label>
          <div id="projects" class="dropdown">No projects loaded</div>
        </div>

        <div class="section">
          <label for="experiences">Experiments</label>
          <div id="experiences" class="dropdown">No experiments loaded</div>
        </div>

        <div class="section">
          <label for="variations">Variations</label>
          <div id="variations" class="dropdown">No variations loaded</div>
        </div>

        <!-- Files Section -->
        <div class="files-header">
          <h3>📁 Files</h3>
        </div>

        <div class="hint visible" id="hint">
          ↑ Drag files from Explorer<br>into the <strong>Drop Files Here</strong> panel above
        </div>

        <div id="file-list"></div>

        <div class="actions">
          <button class="action" onclick="clear()">Clear All</button>
          <button class="action primary" onclick="submit()">Submit</button>
        </div>

        <script src="{{scriptUri}}"></script>
      </body>
      </html>
    `;
  }
}
