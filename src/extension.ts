import * as vscode from "vscode";
import { handleMessage } from "./utils/messageHandler";

export function activate(context: vscode.ExtensionContext) {
  console.log("EXTENSION ACTIVATED123 🚀");
  const provider = new ConvertViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("convertView", provider),
  );
}

class ConvertViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "src", "media"),
      ],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message) => {
      console.log("RECEIVED MESSAGE:", message);
      handleMessage(message, webviewView.webview);
    });
  }

  private getHtml(webview: vscode.Webview) {
    const htmlPath = vscode.Uri.joinPath(
      this.extensionUri,
      "src",
      "media",
      "index.html",
    );
    let html = require("fs").readFileSync(htmlPath.fsPath, "utf-8");

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "src", "media", "script.js"),
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "src", "media", "styles.css"),
    );

    html = html.replace("{{scriptUri}}", scriptUri.toString());
    html = html.replace("{{styleUri}}", styleUri.toString());

    return html;
  }
}
