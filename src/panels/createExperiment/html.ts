import * as vscode from "vscode";

export function getCreateExperimentHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(
      extensionUri,
      "src",
      "panels",
      "createExperiment",
      "script.js",
    ),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(
      extensionUri,
      "src",
      "panels",
      "createExperiment",
      "styles.css",
    ),
  );

  const nonce = getNonce();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"
    >
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${styleUri}" rel="stylesheet">
    <title>Create experiment</title>
  </head>
  <body>
    <main class="wizard-shell">
      <header class="wizard-header">
        <div>
          <h1>Create experiment</h1>
          <p id="projectLabel">Preparing project context...</p>
        </div>
        <div id="stepCounter" class="step-counter"></div>
      </header>

      <nav id="steps" class="steps" aria-label="Experiment creation steps"></nav>

      <section id="errorBox" class="error-box hidden" role="alert"></section>
      <section id="content" class="wizard-content"></section>

      <footer class="wizard-actions">
        <button id="backBtn" type="button" class="secondary">Back</button>
        <button id="nextBtn" type="button">Next</button>
      </footer>
    </main>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

function getNonce(): string {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";

  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}
