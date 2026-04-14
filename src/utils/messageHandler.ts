import { convertApi } from "../services/convertAPI";
import * as vscode from "vscode";

export async function handleMessage(message: any, webview: any, fileStore?: any) {
  try {
    switch (message.command) {
      case "getProjects":
        console.log("📊 GETTING PROJECTS WITH ACCOUNT ID:", message.accountId);
        const projects = await convertApi.getProjects(
          message.apiKey,
          message.accountId,
        );
        webview.postMessage({ command: "projects", data: projects });
        break;

      case "getExperiences":
        console.log(
          "🔬 GETTING EXPERIENCES - Account:",
          message.accountId,
          "Project:",
          message.projectId
        );
        const experiences = await convertApi.getExperiences(
          message.apiKey,
          message.accountId,
          message.projectId,
        );
        webview.postMessage({ command: "experiences", data: experiences });
        break;

      case "getVariations":
        console.log(
          "🎨 GETTING VARIATIONS - Account:",
          message.accountId,
          "Project:",
          message.projectId,
          "Experience:",
          message.experienceId
        );
        const variations = await convertApi.getVariations(
          message.apiKey,
          message.accountId,
          message.projectId,
          message.experienceId,
        );

        const variations_data =
          (variations as any)?.variations?.map((v: any) => ({
            id: v.id,
            name: v.name
          })) || [];

        webview.postMessage({
          command: "variations",
          data: variations_data,
        });
        break;

      case "submit":
        console.log("📤 SUBMITTING FILES");
        if (!fileStore) {
          webview.postMessage({
            command: "error",
            message: "File store not available",
          });
          break;
        }

        const files = fileStore.getAll();
        if (files.length === 0) {
          webview.postMessage({
            command: "error",
            message: "No files selected",
          });
          break;
        }

        const jsFiles: string[] = [];
        const cssFiles: string[] = [];

        // Read and categorize files
        for (const fileUri of files) {
          const content = await vscode.workspace.fs.readFile(fileUri);
          const text = Buffer.from(content).toString("utf-8");
          const fsPath = fileUri.fsPath;

          if (fsPath.endsWith(".js")) {
            jsFiles.push(`/* ${fsPath.split(/[\\\/]/).pop()} */\n${text}`);
          } else if (fsPath.endsWith(".css")) {
            cssFiles.push(`/* ${fsPath.split(/[\\\/]/).pop()} */\n${text}`);
          }
        }

        const jsCode = jsFiles.join("\n\n");
        const cssCode = cssFiles.join("\n\n");

        console.log("📤 JS Code length:", jsCode.length);
        console.log("📤 CSS Code length:", cssCode.length);

        // TODO: Call the API to submit the code
        webview.postMessage({
          command: "success",
          message: `Uploaded ${files.length} file(s)`,
        });

        break;
    }
  } catch (err: any) {
    console.error("❌ Error in handleMessage:", err.message);
    webview.postMessage({
      command: "error",
      message: err.message,
    });
  }
}
