import { convertApi } from "../services/convertAPI";
import * as vscode from "vscode";

export async function handleMessage(
  message: any,
  webview: any,
  fileStore?: any,
  context?: vscode.ExtensionContext,
) {
  try {
    switch (message.command) {
      case "saveConfig": {
        console.log("💾 Saving config:", message.data);

        await context?.globalState.update("convertConfig", message.data);

        const saved = context?.globalState.get("convertConfig");
        console.log("📦 After save:", saved);

        break;
      }
      case "getProjects": {
        console.log("📊 Getting projects for account:", message.accountId);
        const projects = await convertApi.getProjects(
          message.apiKey,
          message.accountId,
        );
        webview.postMessage({ command: "projects", data: projects });
        break;
      }

      case "getExperiences": {
        console.log(
          "🔬 Getting experiences — Account:",
          message.accountId,
          "Project:",
          message.projectId,
        );
        const experiences = await convertApi.getExperiences(
          message.apiKey,
          message.accountId,
          message.projectId,
        );
        webview.postMessage({ command: "experiences", data: experiences });
        break;
      }

      case "getVariations": {
        console.log(
          "🎨 Getting variations — Account:",
          message.accountId,
          "Project:",
          message.projectId,
          "Experience:",
          message.experienceId,
        );
        const variations = await convertApi.getVariations(
          message.apiKey,
          message.accountId,
          message.projectId,
          message.experienceId,
        );

        const variationsData =
          (variations as any)?.variations?.map((v: any) => ({
            id: v.id,
            name: v.name,
          })) || [];

        webview.postMessage({ command: "variations", data: variationsData });
        break;
      }

      case "submit": {
        if (!message.apiKey || !message.accountId) {
          throw new Error("Missing API key or Account ID");
        }

        if (!message.projectId) {
          throw new Error("Project not selected");
        }

        if (!message.experienceId) {
          throw new Error("Experiment not selected");
        }

        if (!message.variationId) {
          throw new Error("Variation not selected");
        }
        console.log("📤 Submitting to Convert...");

        const files: vscode.Uri[] = fileStore.getAll();

        if (!files.length) {
          webview.postMessage({
            command: "error",
            message: "No files selected",
          });
          break;
        }

        const jsFiles: string[] = [];
        const cssFiles: string[] = [];

        for (const fileUri of files) {
          const content = await vscode.workspace.fs.readFile(fileUri);
          const text = Buffer.from(content).toString("utf-8");
          const fileName = fileUri.fsPath.split(/[\\/]/).pop();

          if (
            !fileUri.fsPath.endsWith(".js") &&
            !fileUri.fsPath.endsWith(".css")
          ) {
            webview.postMessage({
              command: "error",
              message: `Invalid file type: ${fileUri.fsPath}`,
            });
            continue;
          }

          const stat = await vscode.workspace.fs.stat(fileUri);

          if (stat.size > 200 * 1024) {
            webview.postMessage({
              command: "error",
              message: `File too large (>200KB): ${fileUri.fsPath}`,
            });
            continue;
          }

          if (fileUri.fsPath.endsWith(".js")) {
            jsFiles.push(`/* ${fileName} */\n${text}`);
          } else if (fileUri.fsPath.endsWith(".css")) {
            cssFiles.push(`/* ${fileName} */\n${text}`);
          }
        }

        const jsCode = jsFiles.join("\n\n");
        const cssCode = cssFiles.join("\n\n");

        console.log("📄 JS length:", jsCode.length);
        console.log("🎨 CSS length:", cssCode.length);

        const response = await convertApi.updateVariation(
          message.apiKey,
          message.accountId,
          message.projectId,
          message.experienceId,
          message.variationId,
          {
            js: jsCode,
            css: cssCode,
          },
        );

        console.log("🚀 Final API response:", response);

        webview.postMessage({
          command: "success",
          message: "Code pushed successfully 🚀",
        });

        break;
      }

      default:
        console.warn("⚠️ Unknown command:", message.command);
    }
  } catch (err: any) {
    console.error("❌ Error in handleMessage:", err.message);
    webview.postMessage({
      command: "error",
      message: err.message,
    });
  }
}
