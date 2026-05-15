import * as vscode from "vscode";

export class FileStore {
  private files: vscode.Uri[] = [];
  private listeners: Array<(uris: vscode.Uri[]) => void> = [];

  add(uris: vscode.Uri[]) {
    const existing = new Set(this.files.map((file) => file.fsPath));
    const nextUris = uris.filter((uri) => !existing.has(uri.fsPath));

    this.files.push(...nextUris);
    this.notify(uris);
  }

  remove(fsPath: string) {
    this.files = this.files.filter((file) => file.fsPath !== fsPath);
    this.notify([]);
  }

  clear() {
    this.files = [];
    this.notify([]);
  }

  getAll(): vscode.Uri[] {
    return [...this.files];
  }

  onChange(listener: (uris: vscode.Uri[]) => void) {
    this.listeners.push(listener);
  }

  private notify(uris: vscode.Uri[]) {
    this.listeners.forEach((listener) => listener([...uris]));
  }
}
