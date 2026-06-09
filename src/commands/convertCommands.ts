import * as vscode from "vscode";
import { getToken } from "../auth/convertAuth";
import { convertApi } from "../services/convertAPI";
import {
  getConvertApiDocsOverview,
  searchConvertApiDocs,
} from "../services/mcp/convertApiDocs";
import {
  DispatchDependencies,
  dispatchCreateExperiment,
  dispatchMessage,
  findMessage,
} from "../services/actions/webviewDispatcher";
import {
  ActiveSelectionState,
  SessionStore,
} from "../services/session/sessionStore";

interface CommandDependencies extends DispatchDependencies {
  showMcpLogs: () => void;
  restartMcpServer: () => Promise<void>;
  getMcpConfigText: () => string;
  checkMcpHealth: () => Promise<unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function isHttpMethod(value: unknown): value is "GET" | "POST" | "PUT" | "DELETE" {
  return ["GET", "POST", "PUT", "DELETE"].includes(asString(value).toUpperCase());
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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

function asObject(value: unknown): object | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as object)
    : undefined;
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

function normalizeExperimentUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function collectUniqueNames(names: string[]): string[] {
  const uniqueNames: string[] = [];
  const seen = new Set<string>();

  names.forEach((name) => {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) {
      return;
    }

    seen.add(key);
    uniqueNames.push(trimmed);
  });

  return uniqueNames;
}

function collectTrimmedNames(names: string[]): string[] {
  return names
    .map((name) => name.trim())
    .filter(Boolean);
}

async function enrichCreateExperimentArgs(
  dependencies: CommandDependencies,
  accountId: string,
  projectId: string,
  args?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const state: Record<string, unknown> = { ...(args ?? {}) };
  state.url = normalizeExperimentUrl(asString(state.url));

  const token = await resolveCommandToken(
    dependencies.context,
    dependencies.sessionStore,
    asString(args?.apiKey),
  );

  const audienceNames = new Set(
    collectUniqueNames([
      ...asStringArray(state.audienceNames),
      asString(state.audienceName),
    ]),
  );

  const audiences = Array.isArray(state.audiences) ? [...state.audiences] : [];
  for (const item of audiences) {
    if (typeof item === "string") {
      audienceNames.add(item.trim());
    } else {
      const record = asRecord(item);
      const id = asNumber(record?.id);
      const name = asString(record?.name).trim();
      if (!id && name) {
        audienceNames.add(name);
      }
    }
  }

  if (audienceNames.size) {
    const response = await convertApi.getAudiences(token, accountId, projectId, "");
    const resolved = [...audienceNames].map((name) => {
      const match = extractListItems(response).find((item) => {
        const record = asRecord(item);
        return asString(record?.name).trim() === name;
      });

      const id = asNumber(asRecord(match)?.id);
      if (id === undefined) {
        throw new Error(`Audience "${name}" was not found in this project.`);
      }

      return { id };
    });

    state.audiences = resolved;
  }

  const selectAllGoals =
    asBoolean(state.selectAllGoals) ||
    state.goals === "all" ||
    (Array.isArray(state.goals) &&
      state.goals.length === 1 &&
      asString(state.goals[0]).toLowerCase() === "all");

  if (selectAllGoals) {
    const response = await convertApi.getGoals(token, accountId, projectId, "");
    const goalIds = extractListItems(response)
      .map((item) => asNumber(asRecord(item)?.id))
      .filter((id): id is number => id !== undefined)
      .map((id) => ({ id }));

    if (!goalIds.length) {
      throw new Error("No active goals were found in this project.");
    }

    state.goals = goalIds;
  }

  const variationNames = collectTrimmedNames([
    ...asStringArray(state.variationNames),
    ...asStringArray(state.additionalVariationNames),
    ...asStringArray(state.variations).map((item) => {
      if (typeof item === "string") {
        return item;
      }
      const record = asRecord(item);
      return asString(record?.name);
    }),
  ]);

  if (variationNames.length) {
    state.variationNames = variationNames;
  }

  delete state.audienceNames;
  delete state.audienceName;
  delete state.selectAllGoals;
  delete state.additionalVariationNames;

  return state;
}

async function resolveCommandToken(
  context: vscode.ExtensionContext,
  sessionStore: SessionStore,
  apiKey?: string,
) {
  const oauthToken = await getToken(context);
  if (oauthToken) {
    return oauthToken;
  }

  if (apiKey?.trim()) {
    return apiKey.trim();
  }

  const selection = await sessionStore.refreshSelectionFromStorage();
  if (selection.apiKey?.trim()) {
    return selection.apiKey.trim();
  }

  throw new Error("Not authenticated. Add an API key or login with Convert.");
}

function resolveSelection(
  selection: ActiveSelectionState,
  patch?: Partial<ActiveSelectionState>,
): ActiveSelectionState {
  return {
    ...selection,
    ...patch,
  };
}

function needsInput(message: string, missing: string[]) {
  return {
    status: "needs_input",
    message,
    missing,
  };
}

async function listProjects(
  dependencies: CommandDependencies,
  args?: { accountId?: string; search?: string; apiKey?: string },
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const accountId = asString(args?.accountId) || selection.accountId || "";

  if (!accountId) {
    return needsInput("Choose an account before listing projects.", ["accountId"]);
  }

  const search = asString(args?.search);
  const cached = !search ? dependencies.sessionStore.getProjects(accountId) : [];
  if (cached.length) {
    return {
      status: "ok",
      accountId,
      data: cached,
      cached: true,
    };
  }

  const token = await resolveCommandToken(
    dependencies.context,
    dependencies.sessionStore,
    args?.apiKey,
  );
  const response = await convertApi.getProjects(
    token,
    accountId,
    search,
  );

  return {
    status: "ok",
    accountId,
    data: response,
  };
}

async function setActiveSelection(
  dependencies: CommandDependencies,
  args?: {
    accountId?: string;
    projectId?: string;
    projectName?: string;
    experienceId?: string;
    experienceName?: string;
    variationId?: string;
    variationName?: string;
    authMode?: "apikey" | "oauth";
  },
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const next = resolveSelection(selection, {
    accountId: asString(args?.accountId) || selection.accountId || "",
    projectId: asString(args?.projectId) || null,
    projectName: asString(args?.projectName),
    experienceId: asString(args?.experienceId) || null,
    experienceName: asString(args?.experienceName),
    variationId: asString(args?.variationId) || null,
    variationName: asString(args?.variationName),
    authMode: args?.authMode === "oauth" ? "oauth" : selection.authMode,
  });

  await dependencies.sessionStore.updateSelection(next);

  return {
    status: "ok",
    selection: next,
  };
}

async function listExperiments(
  dependencies: CommandDependencies,
  args?: {
    accountId?: string;
    projectId?: string;
    search?: string;
    apiKey?: string;
  },
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const resolved = resolveSelection(selection, args);

  if (!resolved.accountId) {
    return needsInput("Choose an account before listing experiments.", ["accountId"]);
  }

  if (!resolved.projectId) {
    return needsInput("Choose a project before listing experiments.", ["projectId"]);
  }

  const search = asString(args?.search);
  const cached = !search ? dependencies.sessionStore.getExperiences(resolved.projectId) : [];
  if (cached.length) {
    return {
      status: "ok",
      accountId: resolved.accountId,
      projectId: resolved.projectId,
      data: cached,
      cached: true,
    };
  }

  const token = await resolveCommandToken(
    dependencies.context,
    dependencies.sessionStore,
    args?.apiKey,
  );
  const response = await convertApi.getExperiences(
    token,
    resolved.accountId,
    resolved.projectId,
    search,
  );

  return {
    status: "ok",
    accountId: resolved.accountId,
    projectId: resolved.projectId,
    data: response,
  };
}

async function listVariations(
  dependencies: CommandDependencies,
  args?: {
    accountId?: string;
    projectId?: string;
    experienceId?: string;
    apiKey?: string;
  },
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const resolved = resolveSelection(selection, args);

  if (!resolved.accountId) {
    return needsInput("Choose an account before listing variations.", ["accountId"]);
  }

  if (!resolved.projectId) {
    return needsInput("Choose a project before listing variations.", ["projectId"]);
  }

  if (!resolved.experienceId) {
    return needsInput("Choose an experiment before listing variations.", ["experienceId"]);
  }

  const cached = dependencies.sessionStore.getVariations(resolved.experienceId);
  if (cached.length) {
    return {
      status: "ok",
      accountId: resolved.accountId,
      projectId: resolved.projectId,
      experienceId: resolved.experienceId,
      data: cached,
      cached: true,
    };
  }

  const token = await resolveCommandToken(
    dependencies.context,
    dependencies.sessionStore,
    args?.apiKey,
  );
  const response = await convertApi.getVariations(
    token,
    resolved.accountId,
    resolved.projectId,
    resolved.experienceId,
  );

  return {
    status: "ok",
    accountId: resolved.accountId,
    projectId: resolved.projectId,
    experienceId: resolved.experienceId,
    data: response,
  };
}

async function getPreviewLink(
  dependencies: CommandDependencies,
  args?: {
    accountId?: string;
    projectId?: string;
    experienceId?: string;
    variationId?: string;
    apiKey?: string;
    copy?: boolean;
  },
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const resolved = resolveSelection(selection, args);

  if (!resolved.accountId) {
    return needsInput("Choose an account before building a preview link.", ["accountId"]);
  }

  if (!resolved.projectId) {
    return needsInput("Choose a project before building a preview link.", ["projectId"]);
  }

  if (!resolved.experienceId) {
    return needsInput("Choose an experiment before building a preview link.", ["experienceId"]);
  }

  if (!resolved.variationId || resolved.variationId === "global") {
    return needsInput(
      "Choose a non-global variation before building a preview link.",
      ["variationId"],
    );
  }

  const token = await resolveCommandToken(
    dependencies.context,
    dependencies.sessionStore,
    args?.apiKey,
  );
  const details = await convertApi.getExperienceDetails(
    token,
    resolved.accountId,
    resolved.projectId,
    resolved.experienceId,
  );
  const detailRecord = (details as { data?: Record<string, unknown> }).data
    ?? (details as Record<string, unknown>);
  const rawUrl = asString(detailRecord.url).trim();

  if (!rawUrl) {
    throw new Error("This experiment does not have a usable base URL.");
  }

  const url = new URL(rawUrl);
  url.searchParams.set("convert_action", "convert_vpreview");
  url.searchParams.set("convert_e", resolved.experienceId);
  url.searchParams.set("convert_v", resolved.variationId);
  const previewLink = url.toString();

  await dependencies.sessionStore.updateSelection({
    accountId: resolved.accountId,
    projectId: resolved.projectId,
    experienceId: resolved.experienceId,
    variationId: resolved.variationId,
  });

  if (args?.copy) {
    await vscode.env.clipboard.writeText(previewLink);
  }

  return {
    status: "ok",
    previewLink,
  };
}

async function getExperimentDetails(
  dependencies: CommandDependencies,
  args?: {
    accountId?: string;
    projectId?: string;
    experienceId?: string;
    apiKey?: string;
  },
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const resolved = resolveSelection(selection, args);

  if (!resolved.accountId || !resolved.projectId || !resolved.experienceId) {
    return needsInput(
      "Choose account, project, and experiment before loading experiment details.",
      ["accountId", "projectId", "experienceId"],
    );
  }

  const token = await resolveCommandToken(
    dependencies.context,
    dependencies.sessionStore,
    args?.apiKey,
  );
  const data = await convertApi.getExperienceDetails(
    token,
    resolved.accountId,
    resolved.projectId,
    resolved.experienceId,
  );

  return {
    status: "ok",
    accountId: resolved.accountId,
    projectId: resolved.projectId,
    experienceId: resolved.experienceId,
    data,
  };
}

async function listLocations(
  dependencies: CommandDependencies,
  args?: {
    accountId?: string;
    projectId?: string;
    search?: string;
    apiKey?: string;
  },
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const resolved = resolveSelection(selection, args);

  if (!resolved.accountId || !resolved.projectId) {
    return needsInput(
      "Choose an account and project before listing locations.",
      ["accountId", "projectId"],
    );
  }

  const token = await resolveCommandToken(
    dependencies.context,
    dependencies.sessionStore,
    args?.apiKey,
  );
  const data = await convertApi.getLocations(
    token,
    resolved.accountId,
    resolved.projectId,
    asString(args?.search),
  );

  return {
    status: "ok",
    accountId: resolved.accountId,
    projectId: resolved.projectId,
    data,
  };
}

async function listAudiences(
  dependencies: CommandDependencies,
  args?: {
    accountId?: string;
    projectId?: string;
    search?: string;
    apiKey?: string;
  },
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const resolved = resolveSelection(selection, args);

  if (!resolved.accountId || !resolved.projectId) {
    return needsInput(
      "Choose an account and project before listing audiences.",
      ["accountId", "projectId"],
    );
  }

  const token = await resolveCommandToken(
    dependencies.context,
    dependencies.sessionStore,
    args?.apiKey,
  );
  const data = await convertApi.getAudiences(
    token,
    resolved.accountId,
    resolved.projectId,
    asString(args?.search),
  );

  return {
    status: "ok",
    accountId: resolved.accountId,
    projectId: resolved.projectId,
    data,
  };
}

async function listGoals(
  dependencies: CommandDependencies,
  args?: {
    accountId?: string;
    projectId?: string;
    search?: string;
    apiKey?: string;
  },
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const resolved = resolveSelection(selection, args);

  if (!resolved.accountId || !resolved.projectId) {
    return needsInput(
      "Choose an account and project before listing goals.",
      ["accountId", "projectId"],
    );
  }

  const token = await resolveCommandToken(
    dependencies.context,
    dependencies.sessionStore,
    args?.apiKey,
  );
  const data = await convertApi.getGoals(
    token,
    resolved.accountId,
    resolved.projectId,
    asString(args?.search),
  );

  return {
    status: "ok",
    accountId: resolved.accountId,
    projectId: resolved.projectId,
    data,
  };
}

async function createLocation(
  dependencies: CommandDependencies,
  args?: Record<string, unknown>,
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const accountId = asString(args?.accountId) || selection.accountId || "";
  const projectId = asString(args?.projectId) || selection.projectId || "";
  const payload = asObject(args?.payload ?? args?.location);

  if (!accountId || !projectId) {
    return needsInput(
      "Choose an account and project before creating a location.",
      ["accountId", "projectId"],
    );
  }

  if (!payload) {
    return needsInput(
      "Provide a location payload before creating a location.",
      ["payload"],
    );
  }

  const token = await resolveCommandToken(
    dependencies.context,
    dependencies.sessionStore,
    asString(args?.apiKey),
  );
  const data = await convertApi.createLocation(token, accountId, projectId, payload as any);

  return {
    status: "ok",
    accountId,
    projectId,
    data,
  };
}

async function createGoal(
  dependencies: CommandDependencies,
  args?: Record<string, unknown>,
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const accountId = asString(args?.accountId) || selection.accountId || "";
  const projectId = asString(args?.projectId) || selection.projectId || "";
  const payload = asObject(args?.payload ?? args?.goal);

  if (!accountId || !projectId) {
    return needsInput(
      "Choose an account and project before creating a goal.",
      ["accountId", "projectId"],
    );
  }

  if (!payload) {
    return needsInput(
      "Provide a goal payload before creating a goal.",
      ["payload"],
    );
  }

  const token = await resolveCommandToken(
    dependencies.context,
    dependencies.sessionStore,
    asString(args?.apiKey),
  );
  const data = await convertApi.createGoal(token, accountId, projectId, payload as any);

  return {
    status: "ok",
    accountId,
    projectId,
    data,
  };
}

function getApiDocsOverview() {
  return {
    status: "ok",
    ...getConvertApiDocsOverview(),
  };
}

function searchApiDocs(args?: Record<string, unknown>) {
  return {
    status: "ok",
    ...searchConvertApiDocs(asString(args?.query)),
  };
}

async function callConvertApi(
  dependencies: CommandDependencies,
  args?: Record<string, unknown>,
) {
  const methodCandidate = asString(args?.method).toUpperCase();
  const method = isHttpMethod(methodCandidate) ? methodCandidate : "GET";
  const path = asString(args?.path).trim();

  if (!path) {
    return needsInput("Provide a Convert API path to call.", ["path"]);
  }

  if (!path.startsWith("/accounts/")) {
    throw new Error("Only Convert API v2 account-scoped paths are allowed.");
  }

  const token = await resolveCommandToken(
    dependencies.context,
    dependencies.sessionStore,
    asString(args?.apiKey),
  );
  const requestBody = asObject(args?.body) ?? asObject(args?.payload);

  const data = await convertApi.requestEndpoint(
    token,
    path,
    method,
    requestBody,
  );

  return {
    status: "ok",
    method,
    path,
    data,
  };
}

async function createExperiment(
  dependencies: CommandDependencies,
  args?: Record<string, unknown>,
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const accountId = asString(args?.accountId) || selection.accountId || "";
  const projectId = asString(args?.projectId) || selection.projectId || "";

  if (!accountId) {
    return needsInput("Choose an account before creating an experiment.", ["accountId"]);
  }

  if (!projectId) {
    return needsInput("Choose a project before creating an experiment.", ["projectId"]);
  }

  const state = await enrichCreateExperimentArgs(
    dependencies,
    accountId,
    projectId,
    args,
  );

  const result = await dispatchCreateExperiment(
    {
      command: "createExperiment",
      accountId,
      projectId,
      apiKey: args?.apiKey,
      state,
    },
    dependencies,
  );
  const error = findMessage<{ errors?: string[]; message?: string }>(
    result.messages,
    "createExperimentFailed",
  );

  if (error) {
    return {
      status: "validation_error",
      message: asString(error.message) || "Create experiment failed.",
      errors: error.errors ?? [],
    };
  }

  const success = findMessage<{ experiment?: Record<string, unknown> }>(
    result.messages,
    "createExperimentSucceeded",
  );

  if (!success?.experiment) {
    throw new Error("Create experiment completed without a success payload.");
  }

  const experiment = success.experiment;
  await dependencies.sessionStore.updateSelection({
    accountId,
    projectId,
    experienceId: asString(experiment.id),
    experienceName: asString(experiment.name),
    variationId: null,
    variationName: "",
  });

  let previewLink = "";
  const shouldReturnPreviewLink =
    asBoolean(args?.returnPreviewLink) || asBoolean(args?.includePreviewLink);

  if (shouldReturnPreviewLink) {
    const variationResponse = await listVariations(dependencies, {
      accountId,
      projectId,
      experienceId: asString(experiment.id),
      apiKey: asString(args?.apiKey),
    });
    const variationData = asRecord(variationResponse);
    const items = extractListItems(variationData?.data ?? variationResponse)
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const firstNonGlobal = items.find(
      (item) => asString(item.id) && asString(item.id) !== "global",
    );

    if (firstNonGlobal) {
      const previewResponse = await getPreviewLink(dependencies, {
        accountId,
        projectId,
        experienceId: asString(experiment.id),
        variationId: asString(firstNonGlobal.id),
        apiKey: asString(args?.apiKey),
      });
      previewLink = asString(asRecord(previewResponse)?.previewLink);
      await dependencies.sessionStore.updateSelection({
        accountId,
        projectId,
        experienceId: asString(experiment.id),
        experienceName: asString(experiment.name),
        variationId: asString(firstNonGlobal.id),
        variationName: asString(firstNonGlobal.name),
      });
    }
  }

  return {
    status: "ok",
    experiment,
    previewLink: previewLink || undefined,
  };
}

async function runDispatchAction(
  command: string,
  dependencies: CommandDependencies,
  payload: Record<string, unknown>,
) {
  const result = await dispatchMessage(
    {
      command,
      ...payload,
    },
    dependencies,
  );
  const error = findMessage<{ message?: string }>(result.messages, "error");
  if (error?.message) {
    throw new Error(error.message);
  }

  const success = findMessage<{ message?: string }>(result.messages, "success");
  const editorOpened = findMessage(result.messages, "editorOpened");
  const editorClosed = findMessage(result.messages, "editorClosed");
  const serverRunning = findMessage(result.messages, "serverRunning");
  const imageUploaded = result.messages.filter((message) => message.command === "imageUploaded");

  return {
    status: "ok",
    message: asString(success?.message),
    editorOpened,
    editorClosed,
    serverRunning,
    imageUploaded,
    messages: result.messages,
  };
}

async function pushCurrentVariation(
  dependencies: CommandDependencies,
  args?: {
    accountId?: string;
    projectId?: string;
    experienceId?: string;
    variationId?: string;
    filePaths?: string[];
    apiKey?: string;
  },
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const resolved = resolveSelection(selection, args);

  if (!resolved.accountId || !resolved.projectId || !resolved.experienceId || !resolved.variationId) {
    return needsInput(
      "Choose account, project, experiment, and variation before pushing code.",
      ["accountId", "projectId", "experienceId", "variationId"],
    );
  }

  const filePaths = asStringArray(args?.filePaths);
  if (!filePaths.length && !dependencies.fileStore.getAll().length) {
    return needsInput("Select JS/CSS files before pushing the current variation.", ["filePaths"]);
  }

  await dependencies.sessionStore.updateSelection({
    accountId: resolved.accountId,
    projectId: resolved.projectId,
    experienceId: resolved.experienceId,
    variationId: resolved.variationId,
  });

  return runDispatchAction("submitVariation", dependencies, {
    ...resolved,
    apiKey: args?.apiKey,
    sessionId: "mcp",
    filePaths,
  });
}

async function pushGlobalCode(
  dependencies: CommandDependencies,
  args?: {
    accountId?: string;
    projectId?: string;
    experienceId?: string;
    filePaths?: string[];
    apiKey?: string;
  },
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const resolved = resolveSelection(selection, args);

  if (!resolved.accountId || !resolved.projectId || !resolved.experienceId) {
    return needsInput(
      "Choose account, project, and experiment before pushing global code.",
      ["accountId", "projectId", "experienceId"],
    );
  }

  const filePaths = asStringArray(args?.filePaths);
  if (!filePaths.length && !dependencies.fileStore.getAll().length) {
    return needsInput("Select JS/CSS files before pushing global code.", ["filePaths"]);
  }

  await dependencies.sessionStore.updateSelection({
    accountId: resolved.accountId,
    projectId: resolved.projectId,
    experienceId: resolved.experienceId,
    variationId: "global",
    variationName: "Global JS and CSS",
  });

  return runDispatchAction("submitGlobal", dependencies, {
    ...resolved,
    apiKey: args?.apiKey,
    sessionId: "mcp",
    filePaths,
  });
}

async function openEditor(
  dependencies: CommandDependencies,
  args?: {
    accountId?: string;
    projectId?: string;
    experienceId?: string;
    variationId?: string;
    experienceName?: string;
    variationName?: string;
    apiKey?: string;
  },
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const resolved = resolveSelection(selection, args);

  if (!resolved.accountId || !resolved.projectId || !resolved.experienceId || !resolved.variationId) {
    return needsInput(
      "Choose account, project, experiment, and variation before opening the editor.",
      ["accountId", "projectId", "experienceId", "variationId"],
    );
  }

  await dependencies.sessionStore.updateSelection({
    accountId: resolved.accountId,
    projectId: resolved.projectId,
    experienceId: resolved.experienceId,
    variationId: resolved.variationId,
    experienceName: resolved.experienceName,
    variationName: resolved.variationName,
  });

  return runDispatchAction("openEditor", dependencies, {
    ...resolved,
    apiKey: args?.apiKey,
    sessionId: "mcp",
    experienceName: asString(args?.experienceName) || resolved.experienceName || resolved.experienceId,
    variationName: asString(args?.variationName) || resolved.variationName || resolved.variationId,
  });
}

async function syncEditorFiles(
  dependencies: CommandDependencies,
  args?: {
    accountId?: string;
    projectId?: string;
    experienceId?: string;
    variationId?: string;
    apiKey?: string;
  },
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const resolved = resolveSelection(selection, args);

  if (!resolved.accountId || !resolved.projectId || !resolved.experienceId || !resolved.variationId) {
    return needsInput(
      "Choose account, project, experiment, and variation before syncing editor files.",
      ["accountId", "projectId", "experienceId", "variationId"],
    );
  }

  await dependencies.sessionStore.updateSelection({
    accountId: resolved.accountId,
    projectId: resolved.projectId,
    experienceId: resolved.experienceId,
    variationId: resolved.variationId,
  });

  return runDispatchAction("pushEditor", dependencies, {
    ...resolved,
    apiKey: args?.apiKey,
    sessionId: "mcp",
  });
}

async function uploadImages(
  dependencies: CommandDependencies,
  args?: {
    accountId?: string;
    projectId?: string;
    imagePaths?: string[];
    imageNames?: string[];
    apiKey?: string;
  },
) {
  const selection = await dependencies.sessionStore.refreshSelectionFromStorage();
  const resolved = resolveSelection(selection, args);
  const imagePaths = asStringArray(args?.imagePaths);
  const imageNames = asStringArray(args?.imageNames);

  if (!resolved.accountId || !resolved.projectId) {
    return needsInput(
      "Choose account and project before uploading images.",
      ["accountId", "projectId"],
    );
  }

  await dependencies.sessionStore.updateSelection({
    accountId: resolved.accountId,
    projectId: resolved.projectId,
  });

  if (!imagePaths.length) {
    return needsInput("Provide one or more image paths to upload.", ["imagePaths"]);
  }

  const uploads = [];
  for (const [index, imagePath] of imagePaths.entries()) {
    const action = await runDispatchAction("uploadSelectedImage", dependencies, {
      ...resolved,
      apiKey: args?.apiKey,
      imagePath,
      imageName: imageNames[index] || "",
      rowId: `mcp_${index}`,
    });
    uploads.push(action.imageUploaded?.[0] ?? action.messages);
  }

  return {
    status: "ok",
    uploads,
  };
}

async function startLocalServer(
  dependencies: CommandDependencies,
  args?: {
    config?: Record<string, unknown>;
  },
) {
  if (!args?.config) {
    return needsInput(
      "Provide a server config object to start the local server.",
      ["config"],
    );
  }

  return runDispatchAction("runServer", dependencies, {
    config: args.config,
  });
}

export function registerConvertCommands(
  context: vscode.ExtensionContext,
  dependencies: CommandDependencies,
) {
  const registrations: Array<[string, (...args: any[]) => any]> = [
    ["convert.getActiveSession", () => dependencies.sessionStore.getSelection()],
    ["convert.getCurrentSelection", () => dependencies.sessionStore.getSelection()],
    ["convert.setActiveSelection", (args?: Record<string, unknown>) => setActiveSelection(dependencies, args)],
    ["convert.listProjects", (args?: Record<string, unknown>) => listProjects(dependencies, args)],
    ["convert.listExperiments", (args?: Record<string, unknown>) => listExperiments(dependencies, args)],
    ["convert.listLocations", (args?: Record<string, unknown>) => listLocations(dependencies, args)],
    ["convert.listAudiences", (args?: Record<string, unknown>) => listAudiences(dependencies, args)],
    ["convert.listGoals", (args?: Record<string, unknown>) => listGoals(dependencies, args)],
    ["convert.listVariations", (args?: Record<string, unknown>) => listVariations(dependencies, args)],
    ["convert.getExperimentDetails", (args?: Record<string, unknown>) => getExperimentDetails(dependencies, args)],
    ["convert.createExperiment", (args?: Record<string, unknown>) => createExperiment(dependencies, args)],
    ["convert.createLocation", (args?: Record<string, unknown>) => createLocation(dependencies, args)],
    ["convert.createGoal", (args?: Record<string, unknown>) => createGoal(dependencies, args)],
    ["convert.pushCurrentVariation", (args?: Record<string, unknown>) => pushCurrentVariation(dependencies, args)],
    ["convert.pushGlobalCode", (args?: Record<string, unknown>) => pushGlobalCode(dependencies, args)],
    ["convert.uploadImages", (args?: Record<string, unknown>) => uploadImages(dependencies, args)],
    ["convert.openEditor", (args?: Record<string, unknown>) => openEditor(dependencies, args)],
    ["convert.syncEditorFiles", (args?: Record<string, unknown>) => syncEditorFiles(dependencies, args)],
    ["convert.startLocalServer", (args?: Record<string, unknown>) => startLocalServer(dependencies, args)],
    ["convert.runPreviewServer", (args?: Record<string, unknown>) => startLocalServer(dependencies, args)],
    ["convert.copyPreviewLink", (args?: Record<string, unknown>) => getPreviewLink(dependencies, { ...args, copy: true })],
    ["convert.getPreviewLink", (args?: Record<string, unknown>) => getPreviewLink(dependencies, args)],
    ["convert.getConvertApiOverview", () => getApiDocsOverview()],
    ["convert.searchConvertApiDocs", (args?: Record<string, unknown>) => searchApiDocs(args)],
    ["convert.callConvertApi", (args?: Record<string, unknown>) => callConvertApi(dependencies, args)],
    ["convert.getMcpConfig", () => dependencies.getMcpConfigText()],
    ["convert.checkMcpHealth", () => dependencies.checkMcpHealth()],
    ["convert.restartMcpServer", () => dependencies.restartMcpServer()],
    ["convert.showMcpLogs", () => dependencies.showMcpLogs()],
  ];

  return vscode.Disposable.from(
    ...registrations.map(([name, handler]) =>
      vscode.commands.registerCommand(name, handler),
    ),
  );
}
