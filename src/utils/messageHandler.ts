import * as vscode from "vscode";
import * as path from "path";
import { randomBytes } from "crypto";
import {
  authenticate,
  cancelAuthentication,
  clearClientId,
  clearToken,
  getClientId as readClientId,
  getStoredAccounts,
  isAuthenticationCancelledError,
  getToken,
  storeClientId,
} from "../auth/convertAuth";
import {
  CreateExperimentPayload,
  CreateGoalPayload,
  CreateLocationPayload,
  convertApi,
} from "../services/convertAPI";
import {
  ActiveSelectionState,
  SessionStore,
} from "../services/session/sessionStore";

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

interface CreatedExperiment {
  id: string;
  name: string;
  url?: string;
  summaryLink?: string;
  apiLink?: string;
}

interface NormalizedCreateExperiment {
  payload: CreateExperimentPayload;
  newLocations: Array<{
    name: string;
    type: string;
    value: string;
    operator: string;
    source: "url" | "javascript";
  }>;
  newGoals: Array<{
    name: string;
    description?: string;
  }>;
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

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
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
    clubJsCss: asBoolean(record.clubJsCss, false),
    minimize: asBoolean(record.minimize, true),
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

function extractListItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = asRecord(payload);
  if (Array.isArray(record?.data)) {
    return record.data;
  }

  const nestedData = asRecord(record?.data);
  if (Array.isArray(nestedData?.data)) {
    return nestedData.data;
  }

  return [];
}

function buildDetailList(
  pairs: Array<{ label: string; value: string | undefined }>,
): Array<{ label: string; value: string }> {
  return pairs
    .map((pair) => ({
      label: pair.label,
      value: (pair.value ?? "").trim(),
    }))
    .filter((pair) => pair.value);
}

function summarizeRuleElement(element: Record<string, unknown>): string {
  const ruleType = asString(element.rule_type).trim();
  const value = asString(element.value).trim();
  const matching = asRecord(element.matching);
  const matchType = asString(matching?.match_type).trim();

  const parts = [ruleType, matchType, value].filter(Boolean);
  return parts.join(" | ");
}

function toPickerItems(payload: unknown, kind = "generic"): Array<{
  id: string;
  name: string;
  type?: string;
  description?: string;
  details?: Array<{ label: string; value: string }>;
}> {
  return extractListItems(payload)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => {
      const type = asString(item.type || item.goal_type);
      const description = asString(item.description).trim();
      const details = buildDetailList(
        kind === "goal"
          ? [
              { label: "ID", value: String(item.id ?? "") },
              { label: "Type", value: type },
              { label: "Key", value: asString(item.key) },
              { label: "Status", value: asString(item.status) },
            ]
          : [
              { label: "ID", value: String(item.id ?? "") },
              { label: "Type", value: type },
              { label: "Status", value: asString(item.status) },
              { label: "Key", value: asString(item.key) },
            ],
      );

      return {
        id: String(item.id ?? ""),
        name: asString(item.name) || String(item.id ?? ""),
        type,
        description: description || undefined,
        details,
      };
    })
    .filter((item) => item.id && item.name);
}

function getNestedRuleElements(location: Record<string, unknown>): Array<Record<string, unknown>> {
  const rules = asRecord(location.rules);
  const orBlocks = Array.isArray(rules?.OR) ? rules.OR : [];
  const elements: Array<Record<string, unknown>> = [];

  for (const orBlock of orBlocks) {
    const andItems = Array.isArray(asRecord(orBlock)?.AND)
      ? (asRecord(orBlock)?.AND as unknown[])
      : [];

    for (const andItem of andItems) {
      const orWhenItems = Array.isArray(asRecord(andItem)?.OR_WHEN)
        ? (asRecord(andItem)?.OR_WHEN as unknown[])
        : [];

      for (const ruleElement of orWhenItems) {
        const record = asRecord(ruleElement);
        if (record) {
          elements.push(record);
        }
      }
    }
  }

  return elements;
}

function deriveLocationVisualEditorUrl(location: Record<string, unknown>): string {
  const elements = getNestedRuleElements(location);

  for (const element of elements) {
    const ruleType = asString(element.rule_type);
    const value = asString(element.value).trim();

    if (!value) {
      continue;
    }

    if ((ruleType === "url" || ruleType === "url_with_query") && /^https?:\/\//i.test(value)) {
      return value;
    }

    if ((ruleType === "url" || ruleType === "url_with_query") && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(value)) {
      return `https://${value}`;
    }
  }

  return "";
}

function toLocationPickerItems(payload: unknown): Array<{
  id: string;
  name: string;
  type?: string;
  description?: string;
  details?: Array<{ label: string; value: string }>;
  visualEditorUrl?: string;
}> {
  return extractListItems(payload)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => {
      const firstRule = getNestedRuleElements(item)[0];
      const visualEditorUrl = deriveLocationVisualEditorUrl(item);

      return {
        id: String(item.id ?? ""),
        name: asString(item.name) || String(item.id ?? ""),
        type: "Location",
        description: asString(item.description).trim() || undefined,
        details: buildDetailList([
          { label: "ID", value: String(item.id ?? "") },
          { label: "Status", value: asString(item.status) },
          { label: "Trigger", value: asString(asRecord(item.trigger)?.type) },
          { label: "Rule", value: firstRule ? summarizeRuleElement(firstRule) : "" },
          { label: "Visual editor URL", value: visualEditorUrl },
        ]),
        visualEditorUrl,
      };
    })
    .filter((item) => item.id && item.name);
}

function slugifyKey(value: string, maxLength = 32): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
}

function buildConvertSummaryLink(
  accountId: string,
  projectId: string,
  experienceId: string,
): string {
  return `https://app.convert.com/accounts/${accountId}/projects/${projectId}/experiences/${experienceId}/summary`;
}

function buildConvertApiExperienceLink(
  accountId: string,
  projectId: string,
  experienceId: string,
): string {
  return `https://api.convert.com/api/v2/accounts/${accountId}/projects/${projectId}/experiences/${experienceId}`;
}

function normalizeCreateExperimentPayload(value: unknown): {
  errors: string[];
  data?: NormalizedCreateExperiment;
} {
  const record = asRecord(value) ?? {};
  const name = asString(record.name).trim();
  const url = asString(record.url).trim();
  const description = asString(record.description).trim();
  const selectedLocations = Array.isArray(record.selectedLocations)
    ? record.selectedLocations
    : [];
  const newLocations = Array.isArray(record.newLocations) ? record.newLocations : [];
  const audiences = Array.isArray(record.audiences) ? record.audiences : [];
  const goals = Array.isArray(record.goals) ? record.goals : [];
  const newGoals = Array.isArray(record.newGoals) ? record.newGoals : [];
  const variationNames = Array.isArray(record.variationNames)
    ? record.variationNames
    : [];
  const additionalVariationNames = Array.isArray(record.additionalVariationNames)
    ? record.additionalVariationNames
    : [];
  const errors: string[] = [];

  if (!name) {
    errors.push("Experiment name is required.");
  }

  if (!url) {
    errors.push("Experiment URL is required.");
  } else {
    try {
      const parsedUrl = new URL(url);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        errors.push("Experiment URL must use http or https.");
      }
    } catch {
      errors.push("Experiment URL must be a valid absolute URL.");
    }
  }

  if (!selectedLocations.length && !newLocations.length) {
    errors.push("Select or create at least one location.");
  }

  const normalizedSelectedLocations = selectedLocations
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      id: asNumber(item.id),
      name: asString(item.name).trim(),
      visualEditorUrl: asString(item.visualEditorUrl).trim(),
    }));

  const normalizedNewLocations = newLocations
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      name: asString(item.name).trim(),
      source: (asString(item.source).trim() === "javascript"
        ? "javascript"
        : "url") as "url" | "javascript",
      type: asString(item.type).trim(),
      operator: asString(item.operator).trim(),
      value: asString(item.value).trim(),
    }));

  normalizedSelectedLocations.forEach((location, index) => {
    if (location.id === undefined) {
      errors.push(`Selected location ${index + 1} is missing an ID.`);
    }
  });

  normalizedNewLocations.forEach((location, index) => {
    if (!location.name) {
      errors.push(`New location ${index + 1} needs a name.`);
    }
    if (!location.type) {
      errors.push(`New location ${index + 1} needs a type.`);
    }
    if (!location.operator) {
      errors.push(`New location ${index + 1} needs a match option.`);
    }
    if (!location.value) {
      errors.push(`New location ${index + 1} needs a value.`);
    }
  });

  const audienceIds = audiences
    .map((item) => asRecord(item))
    .map((item) => asNumber(item?.id))
    .filter((id): id is number => id !== undefined);
  const goalIds = goals
    .map((item) => asRecord(item))
    .map((item) => asNumber(item?.id))
    .filter((id): id is number => id !== undefined);
  const normalizedNewGoals = newGoals
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => ({
      name: asString(item.name).trim(),
      description: asString(item.description).trim(),
    }));

  if (audiences.length !== audienceIds.length) {
    errors.push("Selected audiences must have valid Convert audience IDs.");
  }

  if (goals.length !== goalIds.length) {
    errors.push("Selected goals must have valid Convert goal IDs.");
  }

  normalizedNewGoals.forEach((goal, index) => {
    if (!goal.name) {
      errors.push(`New goal ${index + 1} needs a name.`);
    }
  });

  const normalizedVariationNames = [
    ...variationNames,
    ...additionalVariationNames,
  ]
    .map((item) => asString(item).trim())
    .filter(Boolean);

  const seenVariationNames = new Set<string>();
  normalizedVariationNames.forEach((name) => {
    const key = name.toLowerCase();
    if (key === "original") {
      errors.push("Do not include \"Original\" in variationNames; it is created automatically.");
      return;
    }

    if (seenVariationNames.has(key)) {
      errors.push(`Variation name "${name}" is duplicated.`);
      return;
    }

    seenVariationNames.add(key);
  });

  if (errors.length) {
    return { errors };
  }

  const variations = buildExperimentVariations(normalizedVariationNames);

  const payload: CreateExperimentPayload = {
    name,
    description: description || undefined,
    objective: description || undefined,
    type: "a/b",
    status: "draft",
    url,
    audiences: audienceIds,
    goals: goalIds,
    locations: normalizedSelectedLocations
      .map((location) => location.id)
      .filter((id): id is number => id !== undefined),
    primary_goal: goalIds[0],
    variations,
    settings: {
      matching_options: {
        audiences: "any",
        locations: "any",
      },
    },
  };

  return {
    errors: [],
    data: {
      payload,
      newLocations: normalizedNewLocations,
      newGoals: normalizedNewGoals,
    },
  };
}

function buildTrafficDistributionBuckets(count: number): number[] {
  if (count <= 0) {
    return [];
  }

  const baseBucket = Number((100 / count).toFixed(4));
  const buckets = new Array<number>(count).fill(baseBucket);
  const allocated = Number((baseBucket * (count - 1)).toFixed(4));
  buckets[count - 1] = Number((100 - allocated).toFixed(4));
  return buckets;
}

function buildExperimentVariations(
  additionalVariationNames: string[],
): NonNullable<CreateExperimentPayload["variations"]> {
  const names = additionalVariationNames.length
    ? ["Original", ...additionalVariationNames]
    : ["Original", "Variation 1"];
  const buckets = buildTrafficDistributionBuckets(names.length);

  return names.map((name, index) => ({
    name,
    is_baseline: index === 0,
    traffic_distribution: buckets[index],
  }));
}

function toLocationRuleElement(location: {
  source: "url" | "javascript";
  type: string;
  value: string;
  operator: string;
}) {
  if (location.source === "javascript") {
    return {
      rule_type: "js_condition",
      value: location.value,
      matching: {
        match_type: "equals",
        negated: false,
      },
    };
  }

  return {
    rule_type:
      location.type === "path"
        ? "url"
        : location.type === "domain"
          ? "url"
          : "url",
    value: location.value,
    matching: {
      match_type: location.operator,
      negated: false,
    },
  };
}

function buildCreateLocationPayload(
  experimentName: string,
  location: {
    name: string;
    source: "url" | "javascript";
    type: string;
    value: string;
    operator: string;
  },
  index: number,
): CreateLocationPayload {
  return {
    name:
      location.name || `${experimentName} - ${location.type} ${index + 1}`.slice(0, 100),
    description: `Created by VS Code Create Experiment wizard for ${experimentName}`.slice(0, 500),
    status: "active",
    selected_default: false,
    rules: {
      OR: [
        {
          AND: [
            {
              OR_WHEN: [toLocationRuleElement(location)],
            },
          ],
        },
      ],
    },
    trigger: {
      type: "upon_run",
    },
  };
}

function extractCreatedId(response: unknown, label: string): number {
  const root = asRecord(response);
  const data = asRecord(root?.data) ?? root;
  const id = asNumber(data?.id ?? root?.id);

  if (id === undefined) {
    throw new Error(`Convert created ${label}, but the response did not include an ID.`);
  }

  return id;
}

async function createLocationIds(
  token: string,
  accountId: string,
  projectId: string,
  experimentName: string,
  locations: Array<{
    name: string;
    source: "url" | "javascript";
    type: string;
    value: string;
    operator: string;
  }>,
): Promise<number[]> {
  const createdIds: number[] = [];

  for (const [index, location] of locations.entries()) {
    const response = await convertApi.createLocation(
      token,
      accountId,
      projectId,
      buildCreateLocationPayload(experimentName, location, index),
    );

    createdIds.push(extractCreatedId(response, "location"));
  }

  return createdIds;
}

function buildCreateGoalPayload(goal: {
  name: string;
  description?: string;
}): CreateGoalPayload {
  return {
    name: goal.name,
    description: goal.description || undefined,
    key: slugifyKey(goal.name),
    type: "code_trigger",
    status: "active",
    selected_default: false,
  };
}

async function createGoalIds(
  token: string,
  accountId: string,
  projectId: string,
  goals: Array<{ name: string; description?: string }>,
): Promise<number[]> {
  const createdIds: number[] = [];

  for (const goal of goals) {
    const response = await convertApi.createGoal(
      token,
      accountId,
      projectId,
      buildCreateGoalPayload(goal),
    );

    createdIds.push(extractCreatedId(response, "goal"));
  }

  return createdIds;
}

function extractCreatedExperiment(response: unknown, fallbackName: string): CreatedExperiment {
  const root = asRecord(response);
  const data = asRecord(root?.data) ?? root;
  const id = String(data?.id ?? root?.id ?? "");
  const name = asString(data?.name) || asString(root?.name) || fallbackName;
  const url = asString(data?.url) || asString(root?.url);

  if (!id) {
    throw new Error("Convert created the experiment, but the response did not include an experiment ID.");
  }

  return { id, name, url: url || undefined };
}

function buildVariationPreviewLink(
  baseUrl: string,
  experienceId: string,
  variationId: string,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set("convert_action", "convert_vpreview");
  url.searchParams.set("convert_e", experienceId);
  url.searchParams.set("convert_v", variationId);
  return url.toString();
}

export async function handleCreateExperimentMessage(
  message: Record<string, unknown>,
  webview: WebviewLike,
  context: vscode.ExtensionContext | undefined,
  onCreated: (experiment: CreatedExperiment) => void | Promise<void>,
) {
  try {
    switch (message.command) {
      case "ready": {
        break;
      }

      case "requestAudiences": {
        const token = await resolveToken(message, context);
        const audiences = await convertApi.getAudiences(
          token,
          asString(message.accountId),
          asString(message.projectId),
          asString(message.search),
        );

        await webview.postMessage({
          command: "audiences",
          data: toPickerItems(audiences, "audience"),
        });
        break;
      }

      case "requestLocations": {
        const token = await resolveToken(message, context);
        const locations = await convertApi.getLocations(
          token,
          asString(message.accountId),
          asString(message.projectId),
          asString(message.search),
        );

        await webview.postMessage({
          command: "locations",
          data: toLocationPickerItems(locations),
        });
        break;
      }

      case "requestGoals": {
        const token = await resolveToken(message, context);
        const goals = await convertApi.getGoals(
          token,
          asString(message.accountId),
          asString(message.projectId),
          asString(message.search),
        );

        await webview.postMessage({
          command: "goals",
          data: toPickerItems(goals, "goal"),
        });
        break;
      }

      case "createExperiment": {
        const accountId = asString(message.accountId);
        const projectId = asString(message.projectId);
        validateProjectSelection(accountId, projectId);

        const normalized = normalizeCreateExperimentPayload(message.state);
        if (normalized.errors.length || !normalized.data) {
          await webview.postMessage({
            command: "createExperimentFailed",
            message: "Please fix the highlighted issues.",
            errors: normalized.errors,
          });
          break;
        }

        const token = await resolveToken(message, context);
        const createdLocationIds = await createLocationIds(
          token,
          accountId,
          projectId,
          normalized.data.payload.name,
          normalized.data.newLocations,
        );
        const createdGoalIds = await createGoalIds(
          token,
          accountId,
          projectId,
          normalized.data.newGoals,
        );
        normalized.data.payload.locations = [
          ...(normalized.data.payload.locations ?? []),
          ...createdLocationIds,
        ];
        normalized.data.payload.goals = [
          ...(normalized.data.payload.goals ?? []),
          ...createdGoalIds,
        ];
        if (!normalized.data.payload.primary_goal) {
          normalized.data.payload.primary_goal =
            normalized.data.payload.goals?.[0];
        }

        const response = await convertApi.createExperiment(
          token,
          accountId,
          projectId,
          normalized.data.payload,
        );
        const created = extractCreatedExperiment(
          response,
          normalized.data.payload.name,
        );
        created.summaryLink = buildConvertSummaryLink(
          accountId,
          projectId,
          created.id,
        );
        created.apiLink = buildConvertApiExperienceLink(
          accountId,
          projectId,
          created.id,
        );
        created.url = created.url || normalized.data.payload.url;

        await webview.postMessage({
          command: "createExperimentSucceeded",
          experiment: created,
        });
        await onCreated(created);
        break;
      }

      case "openExternal": {
        const href = asString(message.href).trim();
        if (!href) {
          throw new Error("Missing link to open.");
        }

        await vscode.env.openExternal(vscode.Uri.parse(href));
        break;
      }

      default:
        console.warn("Unknown create experiment command:", message.command);
    }
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await webview.postMessage({
      command: "createExperimentFailed",
      message: errorMessage,
      errors: [errorMessage],
    });
  }
}

export async function handleMessage(
  message: Record<string, unknown>,
  webview: WebviewLike,
  fileStore?: { clear?: () => void; getAll: () => vscode.Uri[] },
  context?: vscode.ExtensionContext,
  sessionStore?: SessionStore,
) {
  try {
    switch (message.command) {
      case "restartMcpServer": {
        await vscode.commands.executeCommand("convert.restartMcpServer");
        await webview.postMessage({
          command: "success",
          message: "MCP server restarted.",
        });
        break;
      }

      case "checkMcpHealth": {
        await vscode.commands.executeCommand("convert.checkMcpHealth");
        await webview.postMessage({
          command: "success",
          message: "MCP status refreshed.",
        });
        break;
      }

      case "showMcpLogs": {
        await vscode.commands.executeCommand("convert.showMcpLogs");
        break;
      }

      case "openCreateExperiment": {
        const accountId = asString(message.accountId);
        const projectId = asString(message.projectId);
        validateProjectSelection(accountId, projectId);

        await vscode.commands.executeCommand("convert.openCreateExperiment", {
          accountId,
          projectId,
          projectName: asString(message.projectName),
          apiKey: typeof message.apiKey === "string" ? message.apiKey : undefined,
        });
        break;
      }

      case "saveConfig": {
        if (!context) {
          break;
        }

        const data =
          typeof message.data === "object" && message.data !== null
            ? (message.data as Record<string, unknown>)
            : {};
        const oauthToken = await getToken(context);

        const selection: ActiveSelectionState = {
          apiKey: asString(data.apiKey) || null,
          accountId: asString(data.accountId),
          projectId: asString(data.projectId) || null,
          projectName: asString(data.projectName),
          experienceId: asString(data.experienceId) || null,
          experienceName: asString(data.experienceName),
          variationId: asString(data.variationId) || null,
          variationName: asString(data.variationName),
          authMode: oauthToken
            ? "oauth"
            : asString(data.authMode) === "oauth"
              ? "oauth"
              : "apikey",
        };

        await context.globalState.update("convertConfig", selection);
        await sessionStore?.updateSelection(selection, {
          persist: false,
        });
        break;
      }

      case "oauthLogin": {
        if (!context) {
          throw new Error("Extension context unavailable");
        }

        await webview.postMessage({
          command: "oauthLoginStarted",
        });

        try {
          const tokenResponse = await authenticate(context);
          const accounts = tokenResponse.scope?.accounts ?? [];

          await webview.postMessage({
            command: "oauthSuccess",
            accounts: accounts.map((account) => ({
              id: String(account.account_id),
              name: account.name,
            })),
          });
        } catch (error: unknown) {
          if (isAuthenticationCancelledError(error)) {
            await webview.postMessage({
              command: "oauthLoginCancelled",
            });
            break;
          }

          throw error;
        }
        break;
      }

      case "oauthCancelLogin": {
        cancelAuthentication();
        break;
      }

      case "oauthLogout": {
        if (!context) {
          throw new Error("Extension context unavailable");
        }

        cancelAuthentication();
        await clearToken(context);
        const saved =
          context.globalState.get<Record<string, unknown>>("convertConfig") ??
          {};

        const selection: ActiveSelectionState = {
          apiKey: asString(saved.apiKey) || null,
          accountId: asString(saved.accountId),
          projectId: asString(saved.projectId) || null,
          experienceId: asString(saved.experienceId) || null,
          variationId: asString(saved.variationId) || null,
          authMode: "apikey",
        };

        await context.globalState.update("convertConfig", selection);
        await sessionStore?.updateSelection(selection, {
          persist: false,
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
        await sessionStore?.updateSelection(
          {
            authMode: "apikey",
            apiKey: null,
            accountId: "",
            projectId: null,
            projectName: "",
            experienceId: null,
            experienceName: "",
            variationId: null,
            variationName: "",
          },
          { persist: false },
        );
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
        sessionStore?.cacheProjects(
          asString(message.accountId),
          extractListItems(projects)
            .map((item) => asRecord(item))
            .filter((item): item is Record<string, unknown> => Boolean(item))
            .map((item) => ({
              id: String(item.id ?? ""),
              name: asString(item.name) || String(item.id ?? ""),
            }))
            .filter((item) => item.id && item.name),
        );
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
        sessionStore?.cacheExperiences(
          asString(message.projectId),
          extractListItems(experiences)
            .map((item) => asRecord(item))
            .filter((item): item is Record<string, unknown> => Boolean(item))
            .map((item) => ({
              id: String(item.id ?? ""),
              name: asString(item.name) || String(item.id ?? ""),
            }))
            .filter((item) => item.id && item.name),
        );
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
        sessionStore?.cacheVariations(
          asString(message.experienceId),
          variationsData,
        );
        break;
      }

      case "copyPreviewLink": {
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

        if (variationId === "global") {
          throw new Error("Preview link is only available for experiment variations.");
        }

        const details = await convertApi.getExperienceDetails(
          token,
          accountId,
          projectId,
          experienceId,
        );
        const detailRecord = asRecord(asRecord(details)?.data) ?? asRecord(details) ?? {};
        const baseUrl = asString(detailRecord.url).trim();

        if (!baseUrl) {
          throw new Error(
            "This experiment does not have a usable experience URL for preview generation.",
          );
        }

        const previewLink = buildVariationPreviewLink(
          baseUrl,
          experienceId,
          variationId,
        );
        await vscode.env.clipboard.writeText(previewLink);
        await webview.postMessage({
          command: "success",
          message: "Preview link copied to clipboard.",
        });
        break;
      }

      case "closeEditor": {
        const sessionId = sanitizeSessionId(asString(message.sessionId));
        const session = editorSessions.get(sessionId);

        await closeEditorSessionFiles(sessionId);
        await webview.postMessage({
          command: "editorClosed",
          sessionId,
          accountId: session?.accountId,
          projectId: session?.projectId,
          experienceId: session?.experienceId,
          variationId: session?.variationId,
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
          accountId,
          projectId,
          experienceId,
          variationId,
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
