import * as vscode from "vscode";
import {
  authenticate,
  clearClientId,
  clearToken,
  getClientId as readClientId,
  getStoredAccounts,
  getToken,
  storeClientId,
} from "../auth/convertAuth";
import { convertApi } from "../services/convertAPI";

type WebviewLike = Pick<vscode.Webview, "postMessage">;

async function resolveToken(
  message: Record<string, unknown>,
  context?: vscode.ExtensionContext,
): Promise<string> {
  if (context) {
    const oauthToken = await getToken(context);
    if (oauthToken) {
      return oauthToken;
    }
  }

  if (typeof message.apiKey === "string" && message.apiKey) {
    return message.apiKey;
  }

  throw new Error(
    "Not authenticated. Please add an API key or login with Convert.",
  );
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function asTimestamp(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function getNextInvalidationTimestamp(project: unknown): number {
  const root = asRecord(project);
  const data = asRecord(root?.data);
  const source = data ?? root;
  const updateMetadata = asRecord(source?.updateMetadata);
  const nextInvalidation = asRecord(updateMetadata?.nextInvalidation);

  return Math.max(
    asTimestamp(nextInvalidation?.js),
    asTimestamp(nextInvalidation?.data),
  );
}

async function postCdnUpdateToast(
  webview: WebviewLike,
  token: string,
  accountId: string,
  projectId: string,
) {
  try {
    const project = await convertApi.getProject(token, accountId, projectId);
    const nextInvalidation = getNextInvalidationTimestamp(project);

    await webview.postMessage({
      command: "cdnUpdate",
      timestamp: nextInvalidation,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("Could not fetch CDN invalidation time:", message);
  }
}

export async function handleMessage(
  message: Record<string, unknown>,
  webview: WebviewLike,
  fileStore?: { clear?: () => void; getAll: () => vscode.Uri[] },
  context?: vscode.ExtensionContext,
) {
  try {
    switch (message.command) {
      case "saveConfig": {
        if (!context) {
          break;
        }

        const data =
          typeof message.data === "object" && message.data !== null
            ? (message.data as Record<string, unknown>)
            : {};
        const oauthToken = await getToken(context);

        await context.globalState.update("convertConfig", {
          ...data,
          authMode: oauthToken ? "oauth" : data.authMode ?? "apikey",
        });
        break;
      }

      case "oauthLogin": {
        if (!context) {
          throw new Error("Extension context unavailable");
        }

        const tokenResponse = await authenticate(context);
        const accounts = tokenResponse.scope?.accounts ?? [];

        await webview.postMessage({
          command: "oauthSuccess",
          accounts: accounts.map((account) => ({
            id: String(account.account_id),
            name: account.name,
          })),
        });
        break;
      }

      case "oauthLogout": {
        if (!context) {
          throw new Error("Extension context unavailable");
        }

        await clearToken(context);
        const saved =
          context.globalState.get<Record<string, unknown>>("convertConfig") ??
          {};

        await context.globalState.update("convertConfig", {
          ...saved,
          authMode: "apikey",
        });

        await webview.postMessage({ command: "oauthLogout" });
        break;
      }

      case "getAccounts": {
        const accounts = context ? await getStoredAccounts(context) : [];

        await webview.postMessage({
          command: "accounts",
          data: accounts.map((account) => ({
            id: String(account.account_id),
            name: account.name,
          })),
        });
        break;
      }

      case "saveClientId": {
        if (!context) {
          throw new Error("Extension context unavailable");
        }

        const clientId = asString(message.clientId).trim();
        await storeClientId(context, clientId);
        await clearToken(context);

        await webview.postMessage({
          command: "clientIdSaved",
          clientId,
        });
        break;
      }

      case "getClientId": {
        const clientId = context ? await readClientId(context) : "";

        await webview.postMessage({
          command: "clientId",
          clientId: clientId ?? "",
        });
        break;
      }

      case "clearAll": {
        if (!context) {
          throw new Error("Extension context unavailable");
        }

        await clearToken(context);
        await clearClientId(context);
        await context.globalState.update("convertConfig", undefined);
        fileStore?.clear?.();
        await webview.postMessage({ command: "clearedAll" });
        break;
      }

      case "getProjects": {
        const token = await resolveToken(message, context);
        const projects = await convertApi.getProjects(
          token,
          asString(message.accountId),
          asString(message.search),
        );

        await webview.postMessage({
          command: "projects",
          data: projects,
        });
        break;
      }

      case "getExperiences": {
        const token = await resolveToken(message, context);
        const experiences = await convertApi.getExperiences(
          token,
          asString(message.accountId),
          asString(message.projectId),
          asString(message.search),
        );

        await webview.postMessage({
          command: "experiences",
          data: experiences,
        });
        break;
      }

      case "getVariations": {
        const token = await resolveToken(message, context);
        const variations = await convertApi.getVariations(
          token,
          asString(message.accountId),
          asString(message.projectId),
          asString(message.experienceId),
        );

        const variationsData =
          (
            variations as {
              variations?: Array<{ id: string | number; name: string }>;
            }
          )?.variations?.map((variation) => ({
            id: String(variation.id),
            name: variation.name,
          })) ?? [];

        variationsData.unshift({
          id: "global",
          name: "Global JS and CSS",
        });

        await webview.postMessage({
          command: "variations",
          data: variationsData,
        });
        break;
      }

      case "submitGlobal": {
        const token = await resolveToken(message, context);
        const files = fileStore?.getAll() ?? [];

        if (!files.length) {
          throw new Error("No files selected");
        }

        let jsCode = "";
        let cssCode = "";

        for (const fileUri of files) {
          const content = await vscode.workspace.fs.readFile(fileUri);
          const text = Buffer.from(content).toString("utf-8");
          const fileName = fileUri.fsPath.split(/[\\/]/).pop();

          if (fileUri.fsPath.endsWith(".js")) {
            jsCode += `\n\n/* ${fileName} */\n${text}`;
          } else if (fileUri.fsPath.endsWith(".css")) {
            cssCode += `\n\n/* ${fileName} */\n${text}`;
          }
        }

        if (!jsCode && !cssCode) {
          throw new Error("No JS or CSS content to upload");
        }

        await convertApi.updateExperience(
          token,
          asString(message.accountId),
          asString(message.projectId),
          asString(message.experienceId),
          {
            global_js: jsCode,
            global_css: cssCode,
          },
        );

        await webview.postMessage({
          command: "success",
          message: "Global JS/CSS updated successfully!",
        });
        await postCdnUpdateToast(
          webview,
          token,
          asString(message.accountId),
          asString(message.projectId),
        );
        break;
      }

      case "submitVariation": {
        const token = await resolveToken(message, context);
        const accountId = asString(message.accountId);
        const projectId = asString(message.projectId);
        const experienceId = asString(message.experienceId);
        const variationId = asString(message.variationId);

        if (!accountId) {
          throw new Error("Missing Account ID");
        }

        if (!projectId) {
          throw new Error("Project not selected");
        }

        if (!experienceId) {
          throw new Error("Experiment not selected");
        }

        if (!variationId) {
          throw new Error("Variation not selected");
        }

        const files = fileStore?.getAll() ?? [];

        if (!files.length) {
          throw new Error("No files selected");
        }

        const jsFiles: string[] = [];
        const cssFiles: string[] = [];

        for (const fileUri of files) {
          const filePath = fileUri.fsPath.toLowerCase();

          if (!filePath.endsWith(".js") && !filePath.endsWith(".css")) {
            throw new Error(`Invalid file type: ${fileUri.fsPath}`);
          }

          const stat = await vscode.workspace.fs.stat(fileUri);

          if (stat.size > 200 * 1024) {
            throw new Error(`File too large (>200KB): ${fileUri.fsPath}`);
          }

          const content = await vscode.workspace.fs.readFile(fileUri);
          const text = Buffer.from(content).toString("utf-8");
          const fileName = fileUri.fsPath.split(/[\\/]/).pop();

          if (filePath.endsWith(".js")) {
            jsFiles.push(`/* ${fileName} */\n${text}`);
          } else {
            cssFiles.push(`/* ${fileName} */\n${text}`);
          }
        }

        await convertApi.updateVariation(
          token,
          accountId,
          projectId,
          experienceId,
          variationId,
          {
            js: jsFiles.join("\n\n"),
            css: cssFiles.join("\n\n"),
          },
        );

        await webview.postMessage({
          command: "success",
          message: "Code pushed successfully!",
        });
        await postCdnUpdateToast(webview, token, accountId, projectId);
        break;
      }

      default:
        console.warn("Unknown command:", message.command);
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Error in handleMessage:", errorMessage);
    await webview.postMessage({
      command: "error",
      message: errorMessage,
    });
  }
}
