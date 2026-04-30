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

interface EditorSession {
  sessionId: string;
  jsUri: vscode.Uri;
  cssUri: vscode.Uri;
  js: string;
  css: string;
}

const editorSessions = new Map<string, EditorSession>();
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

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

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function getWorkspaceRoot(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];

  if (!folder) {
    throw new Error("Open a workspace folder before using the editor workflow.");
  }

  return folder.uri;
}

function sanitizeSessionId(sessionId: string): string {
  const sanitized = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return sanitized || `session_${Date.now()}`;
}

function sanitizeFilePart(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "code";
}

function getEditorBaseName(
  sessionId: string,
  experienceName: string,
  variationName: string,
): string {
  const parts = [
    sanitizeSessionId(sessionId),
    sanitizeFilePart(experienceName),
    sanitizeFilePart(variationName),
  ];

  return parts.join("__");
}

function unwrapData(value: unknown): unknown {
  const record = asRecord(value);
  return record?.data ?? value;
}

function findStringField(value: unknown, fieldName: string): string {
  const record = asRecord(value);

  if (!record) {
    return "";
  }

  const direct = record[fieldName];
  if (typeof direct === "string") {
    return direct;
  }

  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      continue;
    }

    const nested = findStringField(child, fieldName);
    if (nested) {
      return nested;
    }
  }

  return "";
}

function extractCustomCode(
  details: unknown,
  variationId?: string,
): { js: string; css: string } {
  const root = unwrapData(details);
  const rootRecord = asRecord(root);
  const rootDataRecord = asRecord(rootRecord?.data);
  const variations: unknown[] = Array.isArray(rootRecord?.variations)
    ? rootRecord.variations
    : Array.isArray(rootDataRecord?.variations)
      ? rootDataRecord.variations
      : [];
  const variation = variationId
    ? variations
        .map((item) => asRecord(item))
        .find((item) => String(item?.id) === String(variationId))
    : undefined;
  const record = variation ?? rootRecord;
  const dataRecord = asRecord(record?.data);
  const changes: unknown[] = Array.isArray(record?.changes)
    ? record.changes
    : Array.isArray(dataRecord?.changes)
      ? dataRecord.changes
      : [];

  const customCode = changes
    .map((change) => asRecord(change))
    .find((change) => change?.type === "customCode");
  const data = asRecord(customCode?.data);

  return {
    js: typeof data?.js === "string" ? data.js : "",
    css: typeof data?.css === "string" ? data.css : "",
  };
}

function extractGlobalCode(details: unknown): { js: string; css: string } {
  const root = unwrapData(details);

  return {
    js: findStringField(root, "global_js"),
    css: findStringField(root, "global_css"),
  };
}

function findResponseString(value: unknown, fieldName: string): string {
  const record = asRecord(value);

  if (!record) {
    return "";
  }

  const direct = record[fieldName];
  if (typeof direct === "string") {
    return direct;
  }

  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const nested = findResponseString(item, fieldName);
        if (nested) {
          return nested;
        }
      }
      continue;
    }

    const nested = findResponseString(child, fieldName);
    if (nested) {
      return nested;
    }
  }

  return "";
}

function getFileName(uri: vscode.Uri): string {
  return uri.fsPath.split(/[\\/]/).pop() || "image";
}

function getImageMetadata(uri: vscode.Uri, size = 0) {
  const fileName = getFileName(uri);
  const extensionMatch = /(\.[^.\\/]+)$/.exec(fileName);
  const extension = extensionMatch?.[1] ?? "";
  const baseName = extension ? fileName.slice(0, -extension.length) : fileName;

  return {
    fsPath: uri.fsPath,
    fileName,
    baseName,
    extension,
    size,
  };
}

async function pickImages(canSelectMany: boolean): Promise<vscode.Uri[]> {
  return (
    (await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany,
      filters: {
        Images: ["jpg", "jpeg", "png", "gif", "webp", "svg"],
      },
      title: canSelectMany
        ? "Select images to upload to Convert CDN"
        : "Select image to upload to Convert CDN",
    })) ?? []
  );
}

async function uploadImageFromPath(
  token: string,
  accountId: string,
  projectId: string,
  imagePath: string,
  imageName: string,
) {
  const imageUri = vscode.Uri.file(imagePath);
  const imageContent = await vscode.workspace.fs.readFile(imageUri);

  if (imageContent.byteLength > 2 * 1024 * 1024) {
    throw new Error("Image is too large. Max size is 2MB.");
  }

  const metadata = getImageMetadata(imageUri, imageContent.byteLength);
  const cleanName = imageName.trim() || metadata.baseName;
  const finalName = `${cleanName}${metadata.extension}`;
  const response = await convertApi.uploadImage(
    token,
    accountId,
    projectId,
    finalName,
    imageContent,
  );

  return {
    cdnUrl: findResponseString(response, "cdn_url"),
    key: findResponseString(response, "key"),
    imageName: finalName,
  };
}

function getUploadFiles(
  message: Record<string, unknown>,
  fileStore?: { getAll: () => vscode.Uri[] },
): vscode.Uri[] {
  const filePaths = asStringArray(message.filePaths);

  if (filePaths.length) {
    return filePaths.map((filePath) => vscode.Uri.file(filePath));
  }

  return fileStore?.getAll() ?? [];
}

async function readTextFile(uri: vscode.Uri): Promise<string> {
  const content = await vscode.workspace.fs.readFile(uri);
  return textDecoder.decode(content);
}

async function writeTextFile(uri: vscode.Uri, content: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, textEncoder.encode(content));
}

async function closeEditorSessionFiles(sessionId: string): Promise<void> {
  const session = editorSessions.get(sessionId);

  if (!session) {
    return;
  }

  const targetPaths = new Set([session.jsUri.fsPath, session.cssUri.fsPath]);
  const tabsToClose: vscode.Tab[] = [];

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (
        tab.input instanceof vscode.TabInputText &&
        targetPaths.has(tab.input.uri.fsPath)
      ) {
        tabsToClose.push(tab);
      }
    }
  }

  if (tabsToClose.length) {
    try {
      await vscode.window.tabGroups.close(tabsToClose, true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[Convert] Could not close editor tabs for ${sessionId}: ${message}`,
      );
    }
  }

  editorSessions.delete(sessionId);
  console.log(`[Convert] Closed editor files for session ${sessionId}`);
}

async function closeConvertEditorTabs(): Promise<void> {
  const convertDir = vscode.Uri.joinPath(getWorkspaceRoot(), ".convert").fsPath;
  const normalizedConvertDir = convertDir.toLowerCase();
  const tabsToClose: vscode.Tab[] = [];

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.fsPath.toLowerCase().startsWith(normalizedConvertDir)
      ) {
        tabsToClose.push(tab);
      }
    }
  }

  if (tabsToClose.length) {
    try {
      await vscode.window.tabGroups.close(tabsToClose, true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Convert] Could not close previous editor tabs: ${message}`);
    }
  }

  editorSessions.clear();
}

export async function handleEditorDocumentSave(
  document: vscode.TextDocument,
): Promise<void> {
  if (document.uri.scheme !== "file") {
    return;
  }

  const pathParts = document.uri.fsPath.split(/[\\/]/);

  if (!pathParts.includes(".convert")) {
    return;
  }

  const session = [...editorSessions.values()].find(
    (item) =>
      document.uri.fsPath === item.jsUri.fsPath ||
      document.uri.fsPath === item.cssUri.fsPath,
  );

  if (!session) {
    return;
  }

  const text = document.getText();
  const type = document.uri.fsPath === session.jsUri.fsPath ? "js" : "css";

  if (type === "js") {
    session.js = text;
  } else {
    session.css = text;
  }

  console.log(
    `[Convert] Stored ${type.toUpperCase()} editor content for ${session.sessionId}`,
  );
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
          sessionId: asString(message.sessionId),
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
          sessionId: asString(message.sessionId),
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
          sessionId: asString(message.sessionId),
          data: variationsData,
        });
        break;
      }

      case "closeEditor": {
        await closeEditorSessionFiles(sanitizeSessionId(asString(message.sessionId)));
        break;
      }

      case "openEditor": {
        const token = await resolveToken(message, context);
        const sessionId = sanitizeSessionId(asString(message.sessionId));
        const accountId = asString(message.accountId);
        const projectId = asString(message.projectId);
        const experienceId = asString(message.experienceId);
        const variationId = asString(message.variationId);
        const experienceName = asString(message.experienceName) || experienceId;
        const variationName = asString(message.variationName) || variationId;
        const isGlobal = variationId === "global";

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

        console.log(
          `[Convert] Opening editor files for session ${sessionId} (${isGlobal ? "global" : `variation ${variationId}`})`,
        );

        await closeConvertEditorTabs();

        const details = isGlobal
          ? await convertApi.getExperienceDetails(
              token,
              accountId,
              projectId,
              experienceId,
            )
          : await convertApi.getVariationDetails(
              token,
              accountId,
              projectId,
              experienceId,
              variationId,
            );
        const code = isGlobal
          ? extractGlobalCode(details)
          : extractCustomCode(details, variationId);
        const convertDir = vscode.Uri.joinPath(getWorkspaceRoot(), ".convert");
        const editorBaseName = getEditorBaseName(
          sessionId,
          experienceName,
          variationName,
        );
        const jsUri = vscode.Uri.joinPath(convertDir, `${editorBaseName}.js`);
        const cssUri = vscode.Uri.joinPath(convertDir, `${editorBaseName}.css`);

        await vscode.workspace.fs.createDirectory(convertDir);
        await writeTextFile(jsUri, code.js);
        await writeTextFile(cssUri, code.css);

        editorSessions.set(sessionId, {
          sessionId,
          jsUri,
          cssUri,
          js: code.js,
          css: code.css,
        });

        await vscode.window.showTextDocument(jsUri, { preview: false });
        await vscode.window.showTextDocument(cssUri, {
          preview: false,
          viewColumn: vscode.ViewColumn.Beside,
        });

        await webview.postMessage({
          command: "editorOpened",
          sessionId,
          files: {
            js: jsUri.fsPath,
            css: cssUri.fsPath,
          },
        });
        break;
      }

      case "selectImage": {
        const picked = await pickImages(false);
        const imageUri = picked[0];

        if (!imageUri) {
          await webview.postMessage({ command: "imageSelectionCancelled" });
          break;
        }

        const stat = await vscode.workspace.fs.stat(imageUri);
        await webview.postMessage({
          command: "imageSelected",
          image: getImageMetadata(imageUri, stat.size),
        });
        break;
      }

      case "selectImages": {
        const picked = await pickImages(true);

        if (!picked.length) {
          await webview.postMessage({ command: "imageSelectionCancelled" });
          break;
        }

        const images = [];
        for (const imageUri of picked) {
          const stat = await vscode.workspace.fs.stat(imageUri);
          images.push(getImageMetadata(imageUri, stat.size));
        }

        await webview.postMessage({
          command: "imagesSelected",
          images,
        });
        break;
      }

      case "uploadSelectedImage": {
        const token = await resolveToken(message, context);
        const accountId = asString(message.accountId);
        const projectId = asString(message.projectId);
        const imagePath = asString(message.imagePath);
        const rowId = asString(message.rowId);

        if (!accountId) {
          throw new Error("Missing Account ID");
        }

        if (!projectId) {
          throw new Error("Project not selected");
        }

        if (!imagePath) {
          throw new Error("Select an image first");
        }

        try {
          const result = await uploadImageFromPath(
            token,
            accountId,
            projectId,
            imagePath,
            asString(message.imageName),
          );

          await webview.postMessage({
            command: "imageUploaded",
            rowId,
            ...result,
          });
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          await webview.postMessage({
            command: "imageUploadFailed",
            rowId,
            message: errorMessage,
          });
        }
        break;
      }

      case "pushEditor": {
        const token = await resolveToken(message, context);
        const sessionId = sanitizeSessionId(asString(message.sessionId));
        const accountId = asString(message.accountId);
        const projectId = asString(message.projectId);
        const experienceId = asString(message.experienceId);
        const variationId = asString(message.variationId);
        const isGlobal = variationId === "global";
        const session = editorSessions.get(sessionId);
        const convertDir = vscode.Uri.joinPath(getWorkspaceRoot(), ".convert");
        const jsUri =
          session?.jsUri ?? vscode.Uri.joinPath(convertDir, `${sessionId}.js`);
        const cssUri =
          session?.cssUri ?? vscode.Uri.joinPath(convertDir, `${sessionId}.css`);
        let jsCode = "";
        let cssCode = "";

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

        try {
          jsCode = await readTextFile(jsUri);
        } catch {
          console.warn(`[Convert] Missing JS editor file for ${sessionId}`);
        }

        try {
          cssCode = await readTextFile(cssUri);
        } catch {
          console.warn(`[Convert] Missing CSS editor file for ${sessionId}`);
        }

        console.log(
          `[Convert] Pushing editor files for session ${sessionId} (${isGlobal ? "global" : `variation ${variationId}`})`,
        );

        if (isGlobal) {
          await convertApi.updateExperience(
            token,
            accountId,
            projectId,
            experienceId,
            {
              global_js: jsCode,
              global_css: cssCode,
            },
          );
        } else {
          await convertApi.updateVariation(
            token,
            accountId,
            projectId,
            experienceId,
            variationId,
            {
              js: jsCode,
              css: cssCode,
            },
          );
        }

        if (session) {
          session.js = jsCode;
          session.css = cssCode;
        }

        await webview.postMessage({
          command: "success",
          message: "Editor changes pushed successfully!",
        });
        await postCdnUpdateToast(webview, token, accountId, projectId);
        break;
      }

      case "submitGlobal": {
        const token = await resolveToken(message, context);
        const files = getUploadFiles(message, fileStore);

        if (!files.length) {
          throw new Error("No files selected");
        }

        let jsCode = "";
        let cssCode = "";

        for (const fileUri of files) {
          const content = await vscode.workspace.fs.readFile(fileUri);
          const text = Buffer.from(content).toString("utf-8");
          const fileName = fileUri.fsPath.split(/[\\/]/).pop();
          const filePath = fileUri.fsPath.toLowerCase();

          if (filePath.endsWith(".js")) {
            jsCode += `\n\n/* ${fileName} */\n${text}`;
          } else if (filePath.endsWith(".css")) {
            cssCode += `\n\n/* ${fileName} */\n${text}`;
          }
        }

        if (!jsCode && !cssCode) {
          throw new Error("No JS or CSS content to upload");
        }

        if (!jsCode || !cssCode) {
          const existing = extractGlobalCode(
            await convertApi.getExperienceDetails(
              token,
              asString(message.accountId),
              asString(message.projectId),
              asString(message.experienceId),
            ),
          );

          jsCode = jsCode || existing.js;
          cssCode = cssCode || existing.css;
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
          sessionId: asString(message.sessionId),
          source: "upload",
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

        const files = getUploadFiles(message, fileStore);

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

        const currentCode =
          !jsFiles.length || !cssFiles.length
            ? extractCustomCode(
                await convertApi.getVariationDetails(
                  token,
                  accountId,
                  projectId,
                  experienceId,
                  variationId,
                ),
                variationId,
              )
            : { js: "", css: "" };

        await convertApi.updateVariation(
          token,
          accountId,
          projectId,
          experienceId,
          variationId,
          {
            js: jsFiles.length ? jsFiles.join("\n\n") : currentCode.js,
            css: cssFiles.length ? cssFiles.join("\n\n") : currentCode.css,
          },
        );

        await webview.postMessage({
          command: "success",
          sessionId: asString(message.sessionId),
          source: "upload",
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
