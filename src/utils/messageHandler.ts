import * as vscode from "vscode";
import * as path from "path";
import { randomBytes } from "crypto";
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
  accountId: string;
  projectId: string;
  experienceId: string;
  variationId: string;
  jsUri: vscode.Uri;
  cssUri: vscode.Uri;
  js: string;
  css: string;
}

interface ServerVariationConfig {
  name: string;
  jsPath: string;
  cssPath: string;
}

interface ServerConfig {
  id: string;
  name: string;
  serverPath: string;
  rootPath: string;
  domains: string[];
  clubJsCss: boolean;
  minimize: boolean;
  variations: ServerVariationConfig[];
}

interface ServerLocationSuggestion {
  value: string;
  label: string;
}

const SERVER_CONFIGS_KEY = "convertServerConfigs";
const LAST_SERVER_CONFIG_KEY = "convertLastServerConfigId";
const editorSessions = new Map<string, EditorSession>();
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
let serverTerminal: vscode.Terminal | undefined;

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

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asServerConfig(value: unknown): ServerConfig {
  const record = asRecord(value) ?? {};
  const name = asString(record.name).trim();
  const id = asString(record.id).trim();
  const variations = Array.isArray(record.variations)
    ? record.variations
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
          name: asString(item.name).trim(),
          jsPath: asString(item.jsPath).trim(),
          cssPath: asString(item.cssPath).trim(),
        }))
    : [];

  return {
    id,
    name,
    serverPath: asString(record.serverPath).trim(),
    rootPath: asString(record.rootPath || record.outputPath).trim(),
    domains: asStringArray(record.domains)
      .map((domain) => domain.trim())
      .filter(Boolean),
    clubJsCss: asBoolean(record.clubJsCss, true),
    minimize: asBoolean(record.minimize, false),
    variations,
  };
}

function getStoredServerConfigs(context: vscode.ExtensionContext): ServerConfig[] {
  return context.workspaceState.get<ServerConfig[]>(SERVER_CONFIGS_KEY) ?? [];
}

function getPrimaryWorkspacePath(): string {
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!workspacePath) {
    throw new Error("Open a workspace folder before using workspace-relative server paths.");
  }

  return workspacePath;
}

function isFilesystemAbsolutePath(filePath: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(filePath)
    || filePath.startsWith("\\\\")
    || (process.platform !== "win32" && path.isAbsolute(filePath));
}

function resolveWorkspaceOrAbsolutePath(inputPath: string): string {
  const trimmed = inputPath.trim();

  if (!trimmed) {
    return "";
  }

  if (isFilesystemAbsolutePath(trimmed)) {
    return path.normalize(trimmed);
  }

  return path.resolve(getPrimaryWorkspacePath(), trimmed);
}

function resolveChildPath(basePath: string, filePath: string): string {
  if (isFilesystemAbsolutePath(filePath)) {
    return filePath;
  }

  return vscode.Uri.joinPath(
    vscode.Uri.file(basePath),
    filePath.replace(/^[\\/]+/, ""),
  ).fsPath;
}

function normalizeConfigPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function getRelativePath(fromPath: string, toPath: string): string {
  const relative = normalizeConfigPath(path.relative(fromPath, toPath));
  return relative || ".";
}

function getVariationInputPath(rootPath: string, filePath: string): string {
  return normalizeConfigPath(getRelativePath(rootPath, filePath)).replace(/^\/+/, "");
}

function getVariationConfigPath(rootPath: string, filePath: string): string {
  const relative = getVariationInputPath(rootPath, filePath);
  return `/${relative}`;
}

async function resolveVariationSourcePath(
  rootPath: string,
  filePath: string,
): Promise<string> {
  const trimmed = filePath.trim();

  if (!trimmed) {
    return "";
  }

  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith("\\\\")) {
    return path.normalize(trimmed);
  }

  if (process.platform !== "win32" && path.isAbsolute(trimmed)) {
    const normalizedAbsolutePath = path.normalize(trimmed);
    if (await pathExists(normalizedAbsolutePath, vscode.FileType.File)) {
      return normalizedAbsolutePath;
    }
  }

  return vscode.Uri.joinPath(
    vscode.Uri.file(rootPath),
    trimmed.replace(/^[\\/]+/, ""),
  ).fsPath;
}

function materializeServerConfig(config: ServerConfig): ServerConfig {
  return {
    ...config,
    serverPath: resolveWorkspaceOrAbsolutePath(config.serverPath),
    rootPath: resolveWorkspaceOrAbsolutePath(config.rootPath),
  };
}

function generatePrettyServerConfigId(existingIds: Set<string>): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = `CFG-${randomBytes(3).toString("hex").toUpperCase()}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  return `CFG-${Date.now().toString(36).toUpperCase()}`;
}

async function normalizeStoredServerConfigs(
  context: vscode.ExtensionContext,
): Promise<ServerConfig[]> {
  const configs = getStoredServerConfigs(context);
  const seenIds = new Set<string>();
  let changed = false;

  const normalized = configs.map((config) => {
    const trimmedName = config.name.trim();
    let nextId = (config.id || "").trim();

    if (!nextId || nextId === trimmedName || seenIds.has(nextId)) {
      nextId = generatePrettyServerConfigId(seenIds);
      changed = true;
    }

    seenIds.add(nextId);
    return {
      ...config,
      id: nextId,
      name: trimmedName,
    };
  });

  if (changed) {
    await context.workspaceState.update(SERVER_CONFIGS_KEY, normalized);

    const lastConfigId = context.workspaceState.get<string>(LAST_SERVER_CONFIG_KEY);
    const matchingPrevious = configs.find((config) => config.id === lastConfigId);
    const matchingNext = matchingPrevious
      ? normalized.find((config) => config.name === matchingPrevious.name)
      : normalized[0];

    await context.workspaceState.update(
      LAST_SERVER_CONFIG_KEY,
      matchingNext?.id ?? undefined,
    );
  }

  return changed ? normalized : configs;
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

function validateProjectSelection(
  accountId: string,
  projectId: string,
  experienceId?: string,
  variationId?: string,
): void {
  if (!accountId) {
    throw new Error("Missing Account ID");
  }

  if (!projectId) {
    throw new Error("Project not selected");
  }

  if (experienceId !== undefined && !experienceId) {
    throw new Error("Experiment not selected");
  }

  if (variationId !== undefined && !variationId) {
    throw new Error("Variation not selected");
  }
}

function isSupportedImagePath(filePath: string): boolean {
  return /\.(jpe?g|png|gif|webp|svg)$/i.test(filePath);
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
  const metadata = getImageMetadata(imageUri);

  if (!isSupportedImagePath(metadata.fileName)) {
    throw new Error("Only JPG, PNG, GIF, WebP, and SVG images are supported.");
  }

  const imageContent = await vscode.workspace.fs.readFile(imageUri);

  if (!imageContent.byteLength) {
    throw new Error("Image file is empty.");
  }

  if (imageContent.byteLength > 2 * 1024 * 1024) {
    throw new Error("Image is too large. Max size is 2MB.");
  }

  const requestedName = imageName.trim();
  const cleanName = requestedName
    ? requestedName.replace(/(\.[^.\\/]+)$/i, "")
    : metadata.baseName;
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

async function pathExists(path: string, type?: vscode.FileType): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(vscode.Uri.file(path));
    return type === undefined || stat.type === type;
  } catch {
    return false;
  }
}

async function readJsonFile(uri: vscode.Uri): Promise<Record<string, unknown>> {
  const content = await readTextFile(uri);

  try {
    const parsed = JSON.parse(content) as unknown;
    const record = asRecord(parsed);

    if (!record) {
      throw new Error("config.json must contain a JSON object.");
    }

    return record;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to parse ${uri.fsPath}: ${message}`);
  }
}

function getOpenEditorFilePaths(): string[] {
  const paths = new Set<string>();

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        paths.add(tab.input.uri.fsPath);
      }
    }
  }

  return [...paths];
}

function buildServerLocationSuggestions(
  kind: "file" | "folder",
  basePath: string,
): ServerLocationSuggestion[] {
  const resolvedBasePath = basePath.trim()
    ? resolveWorkspaceOrAbsolutePath(basePath)
    : "";
  const normalizedBasePath = resolvedBasePath.toLowerCase();
  const folderPaths = new Set<string>();
  const filePaths = new Set<string>();

  for (const fsPath of getOpenEditorFilePaths()) {
    filePaths.add(fsPath);

    const lastSeparator = Math.max(fsPath.lastIndexOf("\\"), fsPath.lastIndexOf("/"));
    if (lastSeparator > 0) {
      folderPaths.add(fsPath.slice(0, lastSeparator));
    }

    if (
      normalizedBasePath &&
      fsPath.toLowerCase().startsWith(normalizedBasePath)
    ) {
      const relativePath = getVariationInputPath(resolvedBasePath, fsPath);
      filePaths.add(relativePath);
    }
  }

  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    folderPaths.add(folder.uri.fsPath);
  }

  const values = [...(kind === "file" ? filePaths : folderPaths)];
  return values.slice(0, 12).map((value) => ({
    value,
    label: value,
  }));
}

async function validateServerConfig(config: ServerConfig): Promise<string[]> {
  const resolvedConfig = materializeServerConfig(config);
  const errors: string[] = [];
  const seenVariationNames = new Set<string>();

  if (!resolvedConfig.name) {
    errors.push("Config name is required.");
  }

  if (!resolvedConfig.serverPath) {
    errors.push("Server folder path is required.");
  } else if (!(await pathExists(resolvedConfig.serverPath, vscode.FileType.Directory))) {
    errors.push(`Server folder does not exist: ${config.serverPath}`);
  }

  if (!resolvedConfig.rootPath) {
    errors.push("Root/test folder path is required.");
  } else if (!(await pathExists(resolvedConfig.rootPath, vscode.FileType.Directory))) {
    errors.push(`Root/test folder does not exist: ${config.rootPath}`);
  }

  if (!resolvedConfig.variations.length) {
    errors.push("Add at least one variation.");
  }

  for (const [index, variation] of resolvedConfig.variations.entries()) {
    const label = variation.name || `Variation ${index + 1}`;
    const variationKey = variation.name.toLowerCase();

    if (!variation.name) {
      errors.push(`Variation ${index + 1} needs a name.`);
    } else if (seenVariationNames.has(variationKey)) {
      errors.push(`Variation name "${variation.name}" is duplicated.`);
    } else {
      seenVariationNames.add(variationKey);
    }

    if (!variation.jsPath) {
      errors.push(`${label} needs a JS file path.`);
    } else {
      const jsPath = await resolveVariationSourcePath(
        resolvedConfig.rootPath,
        variation.jsPath,
      );
      if (!(await pathExists(jsPath, vscode.FileType.File))) {
        errors.push(`${label} JS file does not exist: ${variation.jsPath}`);
      } else if (!jsPath.toLowerCase().endsWith(".js")) {
        errors.push(`${label} JS path must point to a .js file.`);
      }
    }

    if (!variation.cssPath) {
      errors.push(`${label} needs a CSS file path.`);
    } else {
      const cssPath = await resolveVariationSourcePath(
        resolvedConfig.rootPath,
        variation.cssPath,
      );
      if (!(await pathExists(cssPath, vscode.FileType.File))) {
        errors.push(`${label} CSS file does not exist: ${variation.cssPath}`);
      } else if (!/\.(css|scss|sass)$/i.test(cssPath)) {
        errors.push(`${label} CSS path must point to a .css, .scss, or .sass file.`);
      }
    }
  }

  if (resolvedConfig.serverPath) {
    const configPath = vscode.Uri.joinPath(
      vscode.Uri.file(resolvedConfig.serverPath),
      "config.json",
    );

    if (!(await pathExists(configPath.fsPath, vscode.FileType.File))) {
      errors.push(`Server config file does not exist: ${configPath.fsPath}`);
    }
  }

  return errors;
}

async function updateServerConfigJson(
  configJson: Record<string, unknown>,
  config: ServerConfig,
): Promise<Record<string, unknown>> {
  const resolvedConfig = materializeServerConfig(config);
  const experimentRootPath = resolvedConfig.rootPath;
  const experimentParentPath = path.dirname(experimentRootPath);
  const testDir = getRelativePath(resolvedConfig.serverPath, experimentParentPath);
  const outputDir = getRelativePath(resolvedConfig.serverPath, experimentRootPath);
  const experimentRoot = `/${normalizeConfigPath(path.basename(experimentRootPath))}`;
  const experiments = Array.isArray(configJson.experiments)
    ? configJson.experiments
    : [];
  const firstExperiment = asRecord(experiments[0]) ?? {};
  const existingVariations = Array.isArray(firstExperiment.variations)
    ? firstExperiment.variations.map((item) => asRecord(item) ?? {})
    : [];
  const variations = await Promise.all(resolvedConfig.variations.map(async (variation, index) => {
    const existing = existingVariations[index] ?? {};
    const name = variation.name || `Variation ${index + 1}`;
    const resolvedJsPath = await resolveVariationSourcePath(
      experimentRootPath,
      variation.jsPath,
    );
    const resolvedCssPath = await resolveVariationSourcePath(
      experimentRootPath,
      variation.cssPath,
    );

    return {
      ...existing,
      id: asString(existing.id) || `v${index + 1}`,
      name,
      description: asString(existing.description) || name,
      js: getVariationConfigPath(
        experimentRootPath,
        resolvedJsPath,
      ),
      css: getVariationConfigPath(
        experimentRootPath,
        resolvedCssPath,
      ),
    };
  }));

  return {
    ...configJson,
    testDir,
    outputDir,
    experiments: [
      {
        ...firstExperiment,
        id: resolvedConfig.name,
        name: resolvedConfig.name,
        root: experimentRoot,
        clubJsCss: resolvedConfig.clubJsCss,
        minimize: resolvedConfig.minimize,
        domains: resolvedConfig.domains,
        variations,
      },
      ...experiments.slice(1),
    ],
  };
}

async function saveServerConfigInWorkspace(
  context: vscode.ExtensionContext,
  config: ServerConfig,
): Promise<ServerConfig> {
  const configs = await normalizeStoredServerConfigs(context);
  const trimmedName = config.name.trim();
  const existingIds = new Set(configs.map((item) => item.id));
  const currentConfig = config.id
    ? configs.find((item) => item.id === config.id)
    : undefined;
  const duplicateNameConfig = configs.find(
    (item) => item.name.trim().toLowerCase() === trimmedName.toLowerCase(),
  );

  if (duplicateNameConfig && duplicateNameConfig.id !== config.id) {
    throw new Error(`A saved config named "${trimmedName}" already exists. Choose a different name.`);
  }

  const isRenameOfExistingConfig = Boolean(
    currentConfig
    && currentConfig.name.trim().toLowerCase() !== trimmedName.toLowerCase(),
  );

  const id = !isRenameOfExistingConfig && config.id && (currentConfig || !existingIds.has(config.id))
    ? config.id
    : generatePrettyServerConfigId(existingIds);
  const savedConfig = {
    ...config,
    id,
    name: trimmedName,
  };
  const nextConfigs = [
    savedConfig,
    ...configs.filter((item) => item.id !== id),
  ];

  await context.workspaceState.update(SERVER_CONFIGS_KEY, nextConfigs);
  await context.workspaceState.update(LAST_SERVER_CONFIG_KEY, id);

  return savedConfig;
}

async function clearServerConfigInWorkspace(
  context: vscode.ExtensionContext,
  id: string,
): Promise<ServerConfig[]> {
  const configs = getStoredServerConfigs(context);
  const nextConfigs = configs.filter(
    (item) => item.id !== id,
  );

  await context.workspaceState.update(SERVER_CONFIGS_KEY, nextConfigs);

  const lastConfigId = context.workspaceState.get<string>(LAST_SERVER_CONFIG_KEY);
  if (lastConfigId && lastConfigId === id) {
    await context.workspaceState.update(
      LAST_SERVER_CONFIG_KEY,
      nextConfigs[0]?.id ?? undefined,
    );
  }

  return nextConfigs;
}

async function replaceServerTerminal(
  serverPath: string,
): Promise<vscode.Terminal> {
  if (serverTerminal) {
    serverTerminal.dispose();
    serverTerminal = undefined;
  }

  const terminal = vscode.window.createTerminal({
    name: "AB Codeflame Server",
    cwd: serverPath,
  });
  serverTerminal = terminal;
  terminal.sendText("npm start");
  terminal.show();
  return terminal;
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

function getSessionEditorPaths(session: EditorSession): Set<string> {
  return new Set([session.jsUri.fsPath, session.cssUri.fsPath]);
}

function getOpenEditorTabPaths(): Set<string> {
  const paths = new Set<string>();

  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText) {
        paths.add(tab.input.uri.fsPath);
      }
    }
  }

  return paths;
}

function hasOpenEditorSessionTabs(session: EditorSession): boolean {
  const openPaths = getOpenEditorTabPaths();
  const targetPaths = getSessionEditorPaths(session);

  return [...targetPaths].every((path) => openPaths.has(path));
}

function getDirtyEditorFileNames(session: EditorSession): string[] {
  const targetPaths = getSessionEditorPaths(session);

  return vscode.workspace.textDocuments
    .filter((document) => targetPaths.has(document.uri.fsPath))
    .filter((document) => document.isDirty)
    .map((document) => getFileName(document.uri));
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

async function clearConvertTempFiles(): Promise<void> {
  const convertDir = vscode.Uri.joinPath(getWorkspaceRoot(), ".convert");

  try {
    await vscode.workspace.fs.delete(convertDir, {
      recursive: true,
      useTrash: false,
    });
  } catch (err: unknown) {
    if (
      err instanceof vscode.FileSystemError &&
      err.code === "FileNotFound"
    ) {
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Convert] Could not clear .convert temp files: ${message}`);
  }
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

async function collectCodeFiles(files: vscode.Uri[]): Promise<{
  jsFiles: string[];
  cssFiles: string[];
}> {
  const jsFiles: string[] = [];
  const cssFiles: string[] = [];

  for (const fileUri of files) {
    const filePath = fileUri.fsPath.toLowerCase();

    if (!filePath.endsWith(".js") && !filePath.endsWith(".css")) {
      throw new Error(`Invalid file type: ${fileUri.fsPath}`);
    }

    const stat = await vscode.workspace.fs.stat(fileUri);

    if (stat.type !== vscode.FileType.File) {
      throw new Error(`Not a file: ${fileUri.fsPath}`);
    }

    if (stat.size === 0) {
      throw new Error(`File is empty: ${fileUri.fsPath}`);
    }

    if (stat.size > 200 * 1024) {
      throw new Error(`File too large (>200KB): ${fileUri.fsPath}`);
    }

    const text = await readTextFile(fileUri);
    const fileName = getFileName(fileUri);
    const content = `/* ${fileName} */\n${text}`;

    if (filePath.endsWith(".js")) {
      jsFiles.push(content);
    } else {
      cssFiles.push(content);
    }
  }

  return { jsFiles, cssFiles };
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
        await context.workspaceState.update(SERVER_CONFIGS_KEY, undefined);
        await context.workspaceState.update(LAST_SERVER_CONFIG_KEY, undefined);
        fileStore?.clear?.();
        await webview.postMessage({ command: "clearedAll" });
        break;
      }

      case "loadServerConfigs": {
        if (!context) {
          throw new Error("Extension context unavailable");
        }

        const configs = await normalizeStoredServerConfigs(context);

        await webview.postMessage({
          command: "serverConfigsLoaded",
          configs,
          lastConfigId: context.workspaceState.get<string>(LAST_SERVER_CONFIG_KEY),
        });
        break;
      }

      case "clearServerConfig": {
        if (!context) {
          throw new Error("Extension context unavailable");
        }

        const id = asString(message.id).trim();
        if (!id) {
          throw new Error("Select a saved config to clear.");
        }

        const configs = await clearServerConfigInWorkspace(context, id);
        await webview.postMessage({
          command: "serverConfigCleared",
          message: "Cleared the selected server config.",
          configs,
        });
        break;
      }

      case "clearAllServerConfigs": {
        if (!context) {
          throw new Error("Extension context unavailable");
        }

        await context.workspaceState.update(SERVER_CONFIGS_KEY, []);
        await context.workspaceState.update(LAST_SERVER_CONFIG_KEY, undefined);
        await webview.postMessage({
          command: "allServerConfigsCleared",
          message: "Cleared all stored server configs.",
          configs: [],
        });
        break;
      }

      case "getServerLocationSuggestions": {
        const field = asString(message.field);
        const variationId = asString(message.variationId);
        const kind = asString(message.kind) === "folder" ? "folder" : "file";
        const suggestions = buildServerLocationSuggestions(
          kind,
          asString(message.basePath),
        );

        await webview.postMessage({
          command: "serverLocationSuggestions",
          field,
          variationId,
          suggestions,
        });
        break;
      }

      case "pickServerLocation": {
        const field = asString(message.field);
        const variationId = asString(message.variationId);
        const kind = asString(message.kind) === "folder" ? "folder" : "file";
        const basePath = asString(message.basePath);
        const resolvedBasePath = basePath.trim()
          ? resolveWorkspaceOrAbsolutePath(basePath)
          : "";
        const currentValue = asString(message.currentValue);
        const defaultUri = currentValue
          ? vscode.Uri.file(
              kind === "file"
                ? await resolveVariationSourcePath(resolvedBasePath, currentValue)
                : resolveWorkspaceOrAbsolutePath(currentValue),
            )
          : resolvedBasePath
            ? vscode.Uri.file(resolvedBasePath)
            : undefined;

        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: kind === "file",
          canSelectFolders: kind === "folder",
          canSelectMany: false,
          defaultUri,
          title:
            kind === "folder"
              ? "Select folder"
              : "Select file",
          filters:
            kind === "file"
              ? {
                  Files: field === "cssPath" ? ["css", "scss", "sass"] : ["js"],
                }
              : undefined,
        });

        if (!picked?.[0]) {
          break;
        }

        const pickedPath =
          kind === "file" && resolvedBasePath
            ? getVariationInputPath(resolvedBasePath, picked[0].fsPath)
            : picked[0].fsPath;

        await webview.postMessage({
          command: "serverLocationPicked",
          field,
          variationId,
          path: pickedPath,
        });
        break;
      }

      case "saveServerConfig": {
        if (!context) {
          throw new Error("Extension context unavailable");
        }

        const config = asServerConfig(message.config);
        const errors = await validateServerConfig(config);

        if (errors.length) {
          await webview.postMessage({
            command: "serverValidationError",
            message: "Server config has validation errors.",
            title: "Please fix these server config issues:",
            errors,
          });
          break;
        }

        const savedConfig = await saveServerConfigInWorkspace(context, config);
        await webview.postMessage({
          command: "serverConfigSaved",
          message: `Server config saved as ${savedConfig.name} (${savedConfig.id}).`,
          config: savedConfig,
          configs: getStoredServerConfigs(context),
        });
        break;
      }

      case "previewServerConfig": {
        const config = asServerConfig(message.config);
        const resolvedConfig = materializeServerConfig(config);
        const errors = await validateServerConfig(config);

        if (errors.length) {
          await webview.postMessage({
            command: "serverValidationError",
            message: "Server config has validation errors.",
            title: "Please fix these server config issues:",
            errors,
          });
          break;
        }

        const configUri = vscode.Uri.joinPath(
          vscode.Uri.file(resolvedConfig.serverPath),
          "config.json",
        );
        const configJson = await readJsonFile(configUri);
        const updatedConfigJson = await updateServerConfigJson(configJson, config);

        await writeTextFile(
          configUri,
          `${JSON.stringify(updatedConfigJson, null, 2)}\n`,
        );
        await vscode.window.showTextDocument(configUri, { preview: false });

        await webview.postMessage({
          command: "serverConfigPreviewed",
          message: "Config preview opened.",
          config,
        });
        break;
      }

      case "runServer": {
        if (!context) {
          throw new Error("Extension context unavailable");
        }

        const config = asServerConfig(message.config);
        const resolvedConfig = materializeServerConfig(config);
        const errors = await validateServerConfig(config);

        if (errors.length) {
          await webview.postMessage({
            command: "serverValidationError",
            message: "Server config has validation errors.",
            title: "Please fix these server config issues:",
            errors,
          });
          break;
        }

        const savedConfig = await saveServerConfigInWorkspace(context, config);
        const configUri = vscode.Uri.joinPath(
          vscode.Uri.file(resolvedConfig.serverPath),
          "config.json",
        );
        const configJson = await readJsonFile(configUri);
        const updatedConfigJson = await updateServerConfigJson(configJson, savedConfig);

        await writeTextFile(
          configUri,
          `${JSON.stringify(updatedConfigJson, null, 2)}\n`,
        );

        await replaceServerTerminal(resolvedConfig.serverPath);

        await webview.postMessage({
          command: "serverRunning",
          message: `Server started using ${savedConfig.name} (${savedConfig.id}).`,
          config: savedConfig,
          configs: getStoredServerConfigs(context),
        });
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
        const sessionId = sanitizeSessionId(asString(message.sessionId));

        await closeEditorSessionFiles(sessionId);
        await webview.postMessage({
          command: "editorClosed",
          sessionId,
        });
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

        validateProjectSelection(
          accountId,
          projectId,
          experienceId,
          variationId,
        );

        console.log(
          `[Convert] Opening editor files for session ${sessionId} (${isGlobal ? "global" : `variation ${variationId}`})`,
        );

        await closeConvertEditorTabs();
        await clearConvertTempFiles();

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
          accountId,
          projectId,
          experienceId,
          variationId,
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

      case "selectImage":
      case "selectImages": {
        const multiSelect = message.command === "selectImages";
        const picked = await pickImages(multiSelect);

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
          command: images.length === 1 ? "imageSelected" : "imagesSelected",
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

        validateProjectSelection(accountId, projectId);

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

        validateProjectSelection(
          accountId,
          projectId,
          experienceId,
          variationId,
        );

        if (!session) {
          await webview.postMessage({
            command: "editorClosed",
            sessionId,
          });
          throw new Error("Open editor files before pushing editor changes.");
        }

        if (!hasOpenEditorSessionTabs(session)) {
          editorSessions.delete(sessionId);
          await webview.postMessage({
            command: "editorClosed",
            sessionId,
          });
          throw new Error(
            "Editor session is not active. Open the editor again before pushing.",
          );
        }

        if (
          session.accountId !== accountId ||
          session.projectId !== projectId ||
          session.experienceId !== experienceId ||
          session.variationId !== variationId
        ) {
          editorSessions.delete(sessionId);
          await webview.postMessage({
            command: "editorClosed",
            sessionId,
          });
          throw new Error(
            "Editor files are stale. Open the editor again for the selected project and variation.",
          );
        }

        const dirtyFiles = getDirtyEditorFileNames(session);

        if (dirtyFiles.length) {
          throw new Error(
            `Save editor files before pushing: ${dirtyFiles.join(", ")}`,
          );
        }

        const jsCode = await readTextFile(session.jsUri);
        const cssCode = await readTextFile(session.cssUri);

        if (!jsCode.trim() && !cssCode.trim()) {
          throw new Error("Editor files are empty. Add JS or CSS before pushing.");
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

        session.js = jsCode;
        session.css = cssCode;

        await webview.postMessage({
          command: "success",
          message: "Editor changes pushed successfully!",
        });
        await postCdnUpdateToast(webview, token, accountId, projectId);
        break;
      }

      case "submitGlobal": {
        const token = await resolveToken(message, context);
        const accountId = asString(message.accountId);
        const projectId = asString(message.projectId);
        const experienceId = asString(message.experienceId);
        const files = getUploadFiles(message, fileStore);

        validateProjectSelection(accountId, projectId, experienceId);

        if (!files.length) {
          throw new Error("No files selected");
        }

        const { jsFiles, cssFiles } = await collectCodeFiles(files);
        let jsCode = jsFiles.join("\n\n");
        let cssCode = cssFiles.join("\n\n");

        if (!jsCode && !cssCode) {
          throw new Error("No JS or CSS content to upload");
        }

        if (!jsCode || !cssCode) {
          const existing = extractGlobalCode(
            await convertApi.getExperienceDetails(
              token,
              accountId,
              projectId,
              experienceId,
            ),
          );

          jsCode = jsCode || existing.js;
          cssCode = cssCode || existing.css;
        }

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

        await webview.postMessage({
          command: "success",
          sessionId: asString(message.sessionId),
          source: "upload",
          message: "Global JS/CSS updated successfully!",
        });
        await postCdnUpdateToast(
          webview,
          token,
          accountId,
          projectId,
        );
        break;
      }

      case "submitVariation": {
        const token = await resolveToken(message, context);
        const accountId = asString(message.accountId);
        const projectId = asString(message.projectId);
        const experienceId = asString(message.experienceId);
        const variationId = asString(message.variationId);

        validateProjectSelection(
          accountId,
          projectId,
          experienceId,
          variationId,
        );

        const files = getUploadFiles(message, fileStore);

        if (!files.length) {
          throw new Error("No files selected");
        }

        const { jsFiles, cssFiles } = await collectCodeFiles(files);

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

    if (
      ["saveServerConfig", "previewServerConfig", "runServer", "pickServerLocation", "getServerLocationSuggestions"].includes(
        asString(message.command),
      )
    ) {
      await webview.postMessage({
        command: "serverValidationError",
        message: errorMessage,
        title: "Server action failed",
        errors: [errorMessage],
      });
      return;
    }

    await webview.postMessage({
      command: "error",
      message: errorMessage,
    });
  }
}
