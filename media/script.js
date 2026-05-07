const vscode = acquireVsCodeApi();

const GLOBAL_VARIATION_ID = "global";
const IMAGE_UPLOAD_SESSION_ID = "__imageUpload";
const SERVER_SESSION_ID = "__server";

let authMode = "apikey";
let accounts = [];
let clientId = "";
let isLoading = false;
let editorLoading = false;
let isHydratingRestore = false;
let toastTimer = null;
let pendingSubmit = null;
let sessions = [];
let activeSessionId = "";
let nextSessionNumber = 1;
let uploadFileMemory = {};
let imageUploadState = {
  accountId: "",
  projectId: null,
  projectName: "",
  projectItems: [],
  multipleImages: [],
};
let imageUploadQueue = [];
let serverConfigs = [];
let serverState = createDefaultServerConfig();
let selectedServerConfigId = "";
let isServerConfigDropdownOpen = false;
let serverConfigSearchTerm = "";
let loadedServerConfigId = "";
let loadedServerConfigName = "";

function createServerVariation(seed = {}) {
  return {
    id: seed.id || `variation_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: seed.name || "",
    jsPath: seed.jsPath || "",
    cssPath: seed.cssPath || "",
  };
}

function createEmptyServerConfig(seed = {}) {
  return {
    id: seed.id || "",
    name: seed.name || "",
    serverPath: seed.serverPath || "",
    rootPath: seed.rootPath || seed.outputPath || "",
    domains: Array.isArray(seed.domains) ? seed.domains : [],
    clubJsCss:
      typeof seed.clubJsCss === "boolean" ? seed.clubJsCss : true,
    minimize: typeof seed.minimize === "boolean" ? seed.minimize : false,
    variations: (seed.variations?.length ? seed.variations : [{}]).map(
      createServerVariation,
    ),
  };
}

function createDefaultServerConfig() {
  return createEmptyServerConfig({
    clubJsCss: true,
    minimize: false,
  });
}

function resetLoadedServerConfigTracking() {
  loadedServerConfigId = "";
  loadedServerConfigName = "";
}

function syncServerSearchInput(value = "") {
  serverConfigSearchTerm = value || "";
  setServerInput("serverConfigSearch", serverConfigSearchTerm);
}

function get(id) {
  return document.getElementById(id).value.trim();
}

function set(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.value = value || "";
  }
}

function createSession(seed = {}) {
  const sessionId =
    seed.sessionId ||
    `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const name = seed.name || `Project ${nextSessionNumber++}`;

  return {
    sessionId,
    name,
    accountId: seed.accountId || "",
    projectId: seed.projectId || null,
    projectName: seed.projectName || "",
    experienceId: seed.experienceId || null,
    experienceName: seed.experienceName || "",
    variationId: seed.variationId || null,
    variationName: seed.variationName || "",
    jsFiles: seed.jsFiles || [],
    cssFiles: seed.cssFiles || [],
    editorFiles: seed.editorFiles || { js: "", css: "" },
    projectItems: seed.projectItems || [],
    experienceItems: seed.experienceItems || [],
    variationItems: seed.variationItems || [],
  };
}

function getActiveSession() {
  if (!sessions.length) {
    sessions.push(createSession());
  }

  let session = sessions.find((item) => item.sessionId === activeSessionId);
  if (!session) {
    session = sessions[0];
    if (!isImageUploadActive() && !isServerActive()) {
      activeSessionId = session.sessionId;
    }
  }

  return session;
}

function saveWebviewState() {
  vscode.setState({
    authMode,
    accounts,
    clientId,
    sessions,
    activeSessionId,
    uploadFileMemory,
    imageUploadState,
    serverState,
    apiKey: get("apiKey"),
  });
}

function saveConfig() {
  const session = getActiveProjectContext();

  saveWebviewState();
  vscode.postMessage({
    command: "saveConfig",
    data: {
      apiKey: authMode === "apikey" ? get("apiKey") : null,
      accountId: session.accountId,
      projectId: session.projectId,
      experienceId: isImageUploadActive() ? null : session.experienceId,
      variationId: isImageUploadActive() ? null : session.variationId,
      authMode,
    },
  });
}

function initSessions() {
  const saved = vscode.getState();

  if (saved?.sessions?.length) {
    authMode = saved.authMode || "apikey";
    accounts = saved.accounts || [];
    clientId = saved.clientId || "";
    sessions = saved.sessions;
    activeSessionId = saved.activeSessionId || sessions[0].sessionId;
    renumberSessions();
    nextSessionNumber = sessions.length + 1;
    uploadFileMemory = saved.uploadFileMemory || {};
    imageUploadState = saved.imageUploadState || imageUploadState;
    serverState = createEmptyServerConfig(saved.serverState || {});
    selectedServerConfigId = serverState.id || "";
    loadedServerConfigId = serverState.id || "";
    loadedServerConfigName = serverState.name || "";
    isServerConfigDropdownOpen = false;
    serverConfigSearchTerm = "";
    set("apiKey", saved.apiKey || "");
  } else {
    nextSessionNumber = 1;
    sessions = [createSession()];
    activeSessionId = sessions[0].sessionId;
  }

  renderSession();
  vscode.postMessage({ command: "loadServerConfigs" });
  vscode.postMessage({ command: "getClientId" });
}

function getNextSessionNumber() {
  const usedNumbers = sessions
    .map((session) => /^Project (\d+)$/.exec(session.name || ""))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);

  return Math.max(0, ...usedNumbers) + 1;
}

function isImageUploadActive() {
  return activeSessionId === IMAGE_UPLOAD_SESSION_ID;
}

function isServerActive() {
  return activeSessionId === SERVER_SESSION_ID;
}

function getActiveProjectContext() {
  return isImageUploadActive() ? imageUploadState : getActiveSession();
}

function renumberSessions() {
  sessions.forEach((session, index) => {
    session.name = `Project ${index + 1}`;
  });
}

function addSession() {
  const session = createSession();
  sessions.push(session);
  activeSessionId = session.sessionId;
  renderSession();
  saveConfig();
}

function switchSession(sessionId) {
  activeSessionId = sessionId;
  renderSession();
  saveConfig();
}

function switchImageUpload() {
  activeSessionId = IMAGE_UPLOAD_SESSION_ID;
  renderSession();
  saveWebviewState();
}

function switchServerTab() {
  activeSessionId = SERVER_SESSION_ID;
  renderSession();
  saveWebviewState();
}

function removeSession(sessionId, event) {
  if (event) {
    event.stopPropagation();
  }

  if (sessions.length === 1) {
    showToast("Keep at least one session open", "error");
    return;
  }

  sessions = sessions.filter((session) => session.sessionId !== sessionId);
  if (activeSessionId === sessionId) {
    activeSessionId = sessions[0].sessionId;
  }

  renderSession();
  saveConfig();
}

function renderTabs() {
  const container = document.getElementById("sessionTabs");
  container.innerHTML = "";

  sessions.forEach((session) => {
    const tab = document.createElement("button");
    tab.className =
      session.sessionId === activeSessionId ? "session-tab active" : "session-tab";
    tab.onclick = () => switchSession(session.sessionId);
    tab.title = session.name;

    const label = document.createElement("span");
    label.textContent = session.name;
    tab.appendChild(label);

    const close = document.createElement("span");
    close.className = "session-close";
    close.textContent = "x";
    close.onclick = (event) => removeSession(session.sessionId, event);
    tab.appendChild(close);
    container.appendChild(tab);
  });

  const add = document.createElement("button");
  add.className = "session-tab add-tab";
  add.textContent = "+";
  add.title = "Add session";
  add.onclick = addSession;
  container.appendChild(add);

  const imageTab = document.createElement("button");
  imageTab.className = isImageUploadActive()
    ? "session-tab image-tab active"
    : "session-tab image-tab";
  imageTab.textContent = "Image Upload";
  imageTab.title = "Upload image to CDN";
  imageTab.onclick = switchImageUpload;
  container.appendChild(imageTab);

  const serverTab = document.createElement("button");
  serverTab.className = isServerActive()
    ? "session-tab image-tab active"
    : "session-tab image-tab";
  serverTab.textContent = "Server";
  serverTab.title = "Configure and run local server";
  serverTab.onclick = switchServerTab;
  container.appendChild(serverTab);
}

function renderSession() {
  renderTabs();
  updateAuthUI();
  renderWorkflowMode();

  if (isServerActive()) {
    renderServerView();
  } else {
    const context = getActiveProjectContext();
    set("accountId", context.accountId);
    renderDropdown("projects", context.projectItems, selectProject, {
      selectedId: context.projectId,
      remoteSearch: true,
      collapseWhenSelected: Boolean(context.projectId),
    });
  }

  if (!isImageUploadActive() && !isServerActive()) {
    const session = getActiveSession();
    renderDropdown("experiences", session.experienceItems, selectExperience, {
      selectedId: session.experienceId,
      remoteSearch: true,
      collapseWhenSelected: Boolean(session.experienceId),
    });
    renderDropdown("variations", session.variationItems, selectVariation, {
      selectedId: session.variationId,
      collapseWhenSelected: Boolean(session.variationId),
    });
    renderFiles(getSessionFiles(session));
  }

  renderActiveSummary();
  saveWebviewState();
}

function renderWorkflowMode() {
  const imageMode = isImageUploadActive();
  const serverMode = isServerActive();
  const sharedWorkflowIds = [
    "experienceSection",
    "variationSection",
    "clearSection",
    "editorSection",
    "filesSection",
  ];
  const serverOnlyHiddenIds = [
    "apiKeySection",
    "orSeparator",
    "oauthSection",
    "authActionSection",
    "accountIdSection",
    "accountSelectSection",
    "loadProjectsBtn",
    "projectSection",
  ];

  sharedWorkflowIds.forEach((id) => {
    const element = document.getElementById(id);
    if (!element) {
      return;
    }

    element.style.display = imageMode || serverMode ? "none" : "block";
  });

  serverOnlyHiddenIds.forEach((id) => {
    const element = document.getElementById(id);
    if (!element) {
      return;
    }

    element.style.display = serverMode ? "none" : "block";
  });

  document.querySelectorAll(".workflow-only").forEach((element) => {
    element.style.display = imageMode || serverMode ? "none" : "block";
  });

  document.getElementById("imageUploadView").classList.toggle("hidden", !imageMode);
  document.getElementById("serverView").classList.toggle("hidden", !serverMode);
  renderImageUploadView();
}

function getSessionFiles(session) {
  return [...session.jsFiles, ...session.cssFiles];
}

function getUploadMemoryKey(session) {
  return [
    session.accountId,
    session.projectId,
    session.experienceId,
    session.variationId,
  ]
    .filter(Boolean)
    .join(":");
}

function splitFilesByType(files) {
  return files.reduce(
    (result, file) => {
      if (file.fsPath.toLowerCase().endsWith(".js")) {
        result.jsFiles.push(file);
      } else if (file.fsPath.toLowerCase().endsWith(".css")) {
        result.cssFiles.push(file);
      }

      return result;
    },
    { jsFiles: [], cssFiles: [] },
  );
}

function rememberUploadedFiles(session) {
  const key = getUploadMemoryKey(session);

  if (!key) {
    return;
  }

  uploadFileMemory[key] = getSessionFiles(session);
  saveWebviewState();
}

function restoreUploadedFiles(session) {
  const key = getUploadMemoryKey(session);
  const files = key ? uploadFileMemory[key] || [] : [];
  const split = splitFilesByType(files);

  session.jsFiles = split.jsFiles;
  session.cssFiles = split.cssFiles;
  renderFiles(getSessionFiles(session));
}

function clearSessionFiles(session) {
  getSessionFiles(session).forEach((file) => {
    vscode.postMessage({ type: "remove", fsPath: file.fsPath });
  });

  session.jsFiles = [];
  session.cssFiles = [];
}

function clearSessionEditor(session, closeEditors = true) {
  if (closeEditors && hasOpenEditor(session)) {
    vscode.postMessage({
      command: "closeEditor",
      sessionId: session.sessionId,
    });
  }

  session.editorFiles = { js: "", css: "" };
}

function clearSessionWork(session, options = {}) {
  const includeProject = Boolean(options.includeProject);

  if (includeProject) {
    session.projectId = null;
    session.projectName = "";
    session.projectItems = [];
  }

  session.experienceId = null;
  session.experienceName = "";
  session.variationId = null;
  session.variationName = "";
  session.experienceItems = [];
  session.variationItems = [];
  clearSessionFiles(session);
  clearSessionEditor(session);
}

function renderActiveSummary() {
  if (isImageUploadActive()) {
    const project =
      imageUploadState.projectName || imageUploadState.projectId || "No project";

    document.getElementById("activeSessionName").textContent = "Image Upload";
    document.getElementById("editorContext").textContent = `Uploading to: ${project}`;
    document.getElementById("editorFiles").textContent = "Project CDN image storage";
    return;
  }

  if (isServerActive()) {
    document.getElementById("activeSessionName").textContent = "Server";
    document.getElementById("editorContext").textContent =
      serverState.name || "Local server configuration";
    document.getElementById("editorFiles").textContent =
      serverState.serverPath || "Select a server folder";
    return;
  }

  const session = getActiveSession();
  const project = session.projectName || session.projectId || "No project";
  const variation =
    session.variationName ||
    (session.variationId === GLOBAL_VARIATION_ID ? "Global JS and CSS" : session.variationId) ||
    "No variation";
  const editorFiles = [session.editorFiles?.js, session.editorFiles?.css]
    .filter(Boolean)
    .map((path) => path.split(/[\\/]/).pop())
    .join(" / ");

  document.getElementById("activeSessionName").textContent = session.name;
  document.getElementById("editorContext").textContent = `Editing: ${project} / ${variation}`;
  document.getElementById("editorFiles").textContent = editorFiles
    ? `Files: ${editorFiles}`
    : "Files: not opened yet";
  updateEditorActions();
}

function accountId() {
  return getActiveProjectContext().accountId;
}

function showToast(message, type = "success", duration = 3500) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast visible ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, duration);
}

function formatTimestamp(timestamp) {
  const numeric = Number(timestamp);

  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "Not scheduled";
  }

  const milliseconds = numeric < 1000000000000 ? numeric * 1000 : numeric;
  return new Date(milliseconds).toLocaleString();
}

function setLoading(state) {
  isLoading = state;
  document.getElementById("submitBtn").disabled = state;
  ["selectImagesBtn", "uploadImagesBtn"].forEach((id) => {
    const button = document.getElementById(id);
    if (button) {
      button.disabled = state;
    }
  });
  updateEditorActions();
  document.getElementById("btnText").innerText = state ? "Pushing..." : "Push to Convert";
  document.getElementById("btnLoader").style.display = state ? "inline-block" : "none";
}

function setEditorLoading(state, label = "") {
  editorLoading = state;
  updateEditorActions();
  if (state && label) {
    document.getElementById("openEditorBtn").textContent = label;
  }
}

function hasOpenEditor(session = getActiveSession()) {
  return Boolean(session.editorFiles?.js && session.editorFiles?.css);
}

function updateEditorActions() {
  const openButton = document.getElementById("openEditorBtn");
  const pushButton = document.getElementById("pushEditorBtn");

  if (!openButton || !pushButton || isImageUploadActive()) {
    return;
  }

  const editorIsOpen = hasOpenEditor();
  openButton.disabled = editorLoading;
  openButton.textContent = editorIsOpen ? "Close Editor" : "Open Editor";
  openButton.title = editorIsOpen ? "Close editor files" : "Open editor files";
  pushButton.disabled = editorLoading || !editorIsOpen;
  pushButton.title = editorIsOpen
    ? "Push editor changes"
    : "Open editor files before pushing";
}

function updateAuthUI() {
  const isOauth = authMode === "oauth";

  document.getElementById("apiKeySection").style.display = isOauth ? "none" : "block";
  document.getElementById("oauthSection").style.display = isOauth ? "block" : "none";
  document.getElementById("orSeparator").style.display = isOauth ? "none" : "flex";
  document.getElementById("accountIdSection").style.display = isOauth ? "none" : "block";
  document.getElementById("accountSelectSection").style.display = isOauth ? "block" : "none";
  document.getElementById("authBtn").textContent = isOauth
    ? "Logout from Convert"
    : "Login with Convert";

  renderAccounts();
}

function handleAuthBtn() {
  if (authMode !== "oauth" && !clientId) {
    showToast("Add client ID first", "error");
    return;
  }

  vscode.postMessage({
    command: authMode === "oauth" ? "oauthLogout" : "oauthLogin",
  });
}

function getAuthPayload() {
  if (authMode === "apikey") {
    const apiKey = get("apiKey");
    if (!apiKey) {
      showToast("API Key required", "error");
      return null;
    }
    return { apiKey };
  }

  return {};
}

function clearDropdowns(...ids) {
  ids.forEach((id) => {
    const element = document.getElementById(id);
    if (element) {
      element.innerHTML = "";
    }
  });
}

function resetFormState() {
  authMode = "apikey";
  accounts = [];
  clientId = "";
  uploadFileMemory = {};
  imageUploadState = {
    accountId: "",
    projectId: null,
    projectName: "",
    projectItems: [],
    multipleImages: [],
  };
  serverConfigs = [];
  serverState = createDefaultServerConfig();
  selectedServerConfigId = "";
  isServerConfigDropdownOpen = false;
  resetLoadedServerConfigTracking();
  nextSessionNumber = 1;
  sessions = [createSession({ name: "Project 1" })];
  nextSessionNumber = 2;
  activeSessionId = sessions[0].sessionId;
  isHydratingRestore = false;
  setLoading(false);
  setEditorLoading(false);
  set("apiKey", "");
  set("accountId", "");
  set("clientIdInput", "");
  clearDropdowns("accounts", "projects", "experiences", "variations");
  updateAuthUI();
  renderSession();
}

function clearAll() {
  document.getElementById("clearModal").classList.remove("hidden");
}

function closeClearModal() {
  document.getElementById("clearModal").classList.add("hidden");
}

function clearProjectDetails() {
  const session = getActiveSession();

  clearSessionWork(session, { includeProject: true });
  clearDropdowns("projects", "experiences", "variations");
  renderSession();
  saveConfig();
  closeClearModal();
  showToast("Cleared current project details", "success");
}

function clearAllStoredData() {
  closeClearModal();
  vscode.postMessage({ command: "clearAll" });
}

function selectAccount(id) {
  const session = getActiveProjectContext();

  if (session.accountId !== id) {
    session.projectId = null;
    session.projectName = "";
    session.projectItems = [];
    if (!isImageUploadActive()) {
      session.experienceId = null;
      session.experienceName = "";
      session.variationId = null;
      session.variationName = "";
      session.experienceItems = [];
      session.variationItems = [];
    }
    clearDropdowns("projects", "experiences", "variations");
  }

  session.accountId = id;
  set("accountId", id);
  saveConfig();
  renderActiveSummary();
}

function loadProjects() {
  const auth = getAuthPayload();
  const session = getActiveProjectContext();
  if (auth === null) {
    return;
  }

  if (!session.accountId) {
    showToast("Account required", "error");
    return;
  }

  isHydratingRestore = Boolean(session.projectId);

  vscode.postMessage({
    command: "getProjects",
    ...auth,
    sessionId: isImageUploadActive() ? IMAGE_UPLOAD_SESSION_ID : session.sessionId,
    accountId: session.accountId,
  });
}

function requestExperiences(projectId, search = "") {
  const auth = getAuthPayload();
  const session = getActiveSession();
  if (auth === null) {
    return;
  }

  vscode.postMessage({
    command: "getExperiences",
    ...auth,
    sessionId: session.sessionId,
    accountId: session.accountId,
    projectId,
    search,
  });
}

function requestVariations(experienceId) {
  const auth = getAuthPayload();
  const session = getActiveSession();
  if (auth === null) {
    return;
  }

  vscode.postMessage({
    command: "getVariations",
    ...auth,
    sessionId: session.sessionId,
    accountId: session.accountId,
    projectId: session.projectId,
    experienceId,
  });
}

function selectProject(id) {
  const session = getActiveProjectContext();
  const selected = session.projectItems.find((item) => String(item.id) === String(id));

  if (isImageUploadActive()) {
    session.projectId = id;
    session.projectName = selected?.name || id;
    saveWebviewState();
    renderActiveSummary();
    return;
  }

  if (session.projectId !== id) {
    clearSessionWork(session);
    clearDropdowns("experiences", "variations");
    renderFiles([]);
  }

  session.projectId = id;
  session.projectName = selected?.name || id;
  saveConfig();
  renderTabs();
  renderActiveSummary();
  requestExperiences(id);
}

function selectExperience(id) {
  const session = getActiveSession();
  const selected = session.experienceItems.find((item) => String(item.id) === String(id));

  if (session.experienceId !== id) {
    session.variationId = null;
    session.variationName = "";
    session.variationItems = [];
    clearSessionFiles(session);
    clearSessionEditor(session);
    clearDropdowns("variations");
    renderFiles([]);
  }

  session.experienceId = id;
  session.experienceName = selected?.name || id;
  saveConfig();
  renderActiveSummary();
  requestVariations(id);
}

function selectVariation(id) {
  const session = getActiveSession();
  const selected = session.variationItems.find((item) => String(item.id) === String(id));

  if (session.variationId !== id) {
    clearSessionFiles(session);
    clearSessionEditor(session);
  }

  session.variationId = id;
  session.variationName = selected?.name || (id === GLOBAL_VARIATION_ID ? "Global JS and CSS" : id);
  restoreUploadedFiles(session);
  saveConfig();
  renderActiveSummary();
}

function validateSelection() {
  const session = getActiveSession();

  if (authMode === "apikey" && !get("apiKey")) {
    return "API Key required";
  }
  if (!session.accountId) {
    return "Account required";
  }
  if (!session.projectId) {
    return "Select project";
  }
  if (!session.experienceId) {
    return "Select experiment";
  }
  if (!session.variationId) {
    return "Select variation";
  }
  return null;
}

function submit() {
  const error = validateSelection();
  if (error) {
    showToast(error, "error");
    return;
  }

  if (isLoading) {
    return;
  }

  const session = getActiveSession();
  const target =
    session.variationId === GLOBAL_VARIATION_ID ? "Global JS and CSS" : "selected variation";
  openModal(`Push code to ${target}?`, () => executeSubmit());
}

function executeSubmit() {
  const auth = getAuthPayload();
  const session = getActiveSession();
  if (auth === null) {
    return;
  }

  setLoading(true);

  vscode.postMessage({
    command: session.variationId === GLOBAL_VARIATION_ID ? "submitGlobal" : "submitVariation",
    ...auth,
    sessionId: session.sessionId,
    accountId: session.accountId,
    projectId: session.projectId,
    experienceId: session.experienceId,
    variationId: session.variationId,
    filePaths: getSessionFiles(session).map((file) => file.fsPath),
  });
}

function openEditor() {
  const error = validateSelection();
  const auth = getAuthPayload();
  const session = getActiveSession();

  if (error) {
    showToast(error, "error");
    return;
  }

  if (hasOpenEditor(session)) {
    closeActiveEditor();
    return;
  }

  if (auth === null || editorLoading) {
    return;
  }

  setEditorLoading(true, "Opening...");
  vscode.postMessage({
    command: "openEditor",
    ...auth,
    sessionId: session.sessionId,
    accountId: session.accountId,
    projectId: session.projectId,
    experienceId: session.experienceId,
    variationId: session.variationId,
    experienceName: session.experienceName,
    variationName: session.variationName,
  });
}

function closeActiveEditor() {
  const session = getActiveSession();

  if (!hasOpenEditor(session) || editorLoading) {
    return;
  }

  setEditorLoading(true, "Closing...");
  vscode.postMessage({
    command: "closeEditor",
    sessionId: session.sessionId,
  });
}

function pushEditor() {
  const error = validateSelection();
  const auth = getAuthPayload();
  const session = getActiveSession();

  if (error) {
    showToast(error, "error");
    return;
  }

  if (!hasOpenEditor(session)) {
    showToast("Open editor files before pushing", "error");
    return;
  }

  if (auth === null || editorLoading) {
    return;
  }

  setEditorLoading(true, "Pushing...");
  vscode.postMessage({
    command: "pushEditor",
    ...auth,
    sessionId: session.sessionId,
    accountId: session.accountId,
    projectId: session.projectId,
    experienceId: session.experienceId,
    variationId: session.variationId,
  });
}

function validateImageProject() {
  const auth = getAuthPayload();

  if (auth === null) {
    return null;
  }

  if (!imageUploadState.accountId) {
    showToast("Account required", "error");
    return null;
  }

  if (!imageUploadState.projectId) {
    showToast("Select project", "error");
    return null;
  }

  return auth;
}

function selectImage() {
  vscode.postMessage({ command: "selectImages" });
}

function selectImages() {
  vscode.postMessage({ command: "selectImages" });
}

function buildImageName(name, fallback) {
  return (name || "").trim() || fallback || "image";
}

function uploadImages() {
  const auth = validateImageProject();

  if (auth === null) {
    return;
  }

  const pending = imageUploadState.multipleImages.filter(
    (image) => image.status !== "uploaded",
  );

  if (!pending.length) {
    showToast("Select images first", "error");
    return;
  }

  imageUploadQueue = pending.map((image) => image.id);
  setLoading(true);
  uploadNextImage(auth);
}

function uploadNextImage(auth) {
  if (auth === null) {
    setLoading(false);
    return;
  }

  const rowId = imageUploadQueue.shift();

  if (!rowId) {
    setLoading(false);
    showToast("Image upload complete", "success");
    saveWebviewState();
    return;
  }

  const image = imageUploadState.multipleImages.find((item) => item.id === rowId);
  if (!image) {
    uploadNextImage(auth);
    return;
  }

  image.status = "uploading";
  image.error = "";
  renderMultipleImageTable();
  vscode.postMessage({
    command: "uploadSelectedImage",
    ...auth,
    rowId,
    accountId: imageUploadState.accountId,
    projectId: imageUploadState.projectId,
    imagePath: image.fsPath,
    imageName: buildImageName(image.imageName, image.baseName),
  });
}

function renderImageUploadView() {
  renderMultipleImageTable();
}

function renderMultipleImageTable() {
  const container = document.getElementById("multipleImageTable");
  const images = imageUploadState.multipleImages || [];

  if (!images.length) {
    container.innerHTML = '<div class="image-selected muted">No images selected</div>';
    return;
  }

  const rows = images
    .map(
      (image) => `
        <tr>
          <td title="${escapeHtml(image.fileName)}">${escapeHtml(image.fileName)}</td>
          <td>
            <input value="${escapeHtml(image.imageName)}" oninput="updateMultipleImageName('${image.id}', this.value)" />
            <span class="image-extension">${escapeHtml(image.extension)}</span>
          </td>
          <td class="status-${escapeHtml(image.status)}">${escapeHtml(image.status)}</td>
          <td class="cdn-cell">${escapeHtml(image.cdnUrl || image.error || "")}</td>
        </tr>
      `,
    )
    .join("");

  container.innerHTML = `
    <table class="image-table">
      <thead>
        <tr>
          <th>Image</th>
          <th>Name</th>
          <th>Status</th>
          <th>CDN URL</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function updateMultipleImageName(id, value) {
  const image = imageUploadState.multipleImages.find((item) => item.id === id);

  if (image) {
    image.imageName = value;
    saveWebviewState();
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function requestClearImageUpload() {
  document.getElementById("imageClearModal").classList.remove("hidden");
}

function closeImageClearModal() {
  document.getElementById("imageClearModal").classList.add("hidden");
}

function confirmClearImageUpload() {
  imageUploadState.multipleImages = [];
  imageUploadQueue = [];
  closeImageClearModal();
  renderImageUploadView();
  saveWebviewState();
}

function getServerInput(id) {
  const element = document.getElementById(id);
  return element ? element.value.trim() : "";
}

function setServerInput(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.value = value || "";
  }
}

function getServerDomains() {
  return (serverState.domains || [])
    .map((domain) => String(domain || "").trim())
    .filter(Boolean);
}

function collectServerConfigFromForm() {
  const name = getServerInput("serverConfigName");

  return {
    id: serverState.id || "",
    name,
    serverPath: getServerInput("serverPath"),
    rootPath: getServerInput("serverRootPath"),
    domains: getServerDomains(),
    clubJsCss: serverState.clubJsCss,
    minimize: serverState.minimize,
    variations: serverState.variations.map((variation) => ({
      name: variation.name.trim(),
      jsPath: variation.jsPath.trim(),
      cssPath: variation.cssPath.trim(),
    })),
  };
}

function setServerErrors(errors, title = "Fix the following before continuing:") {
  const container = document.getElementById("serverErrors");
  if (!container) {
    return;
  }

  if (!errors.length) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  container.classList.remove("hidden");
  container.innerHTML = `<strong>${escapeHtml(title)}</strong>${errors
    .map((error) => `<div>${escapeHtml(error)}</div>`)
    .join("")}`;
}

function validateServerForm(config = collectServerConfigFromForm()) {
  const errors = [];
  const variationNames = new Set();
  const filledDomains = (serverState.domains || []).filter((domain) =>
    String(domain || "").trim(),
  );
  const emptyDomains = (serverState.domains || []).filter((domain) =>
    !String(domain || "").trim(),
  );

  if (!config.name) {
    errors.push("Config name is required.");
  }

  if (!config.serverPath) {
    errors.push("Server folder path is required.");
  }

  if (!config.rootPath) {
    errors.push("Root/test folder path is required.");
  }

  if (!config.variations.length) {
    errors.push("Add at least one variation.");
  }

  if (filledDomains.length && emptyDomains.length) {
    errors.push("Fill or remove empty domain rows before continuing.");
  }

  config.variations.forEach((variation, index) => {
    const label = variation.name || `Variation ${index + 1}`;
    const key = variation.name.toLowerCase();

    if (!variation.name) {
      errors.push(`Variation ${index + 1} needs a name.`);
    } else if (variationNames.has(key)) {
      errors.push(`Variation name "${variation.name}" is duplicated.`);
    } else {
      variationNames.add(key);
    }

    if (!variation.jsPath) {
      errors.push(`${label} needs a JS file path.`);
    }

    if (!variation.cssPath) {
      errors.push(`${label} needs a CSS file path.`);
    }
  });

  return errors;
}

function validateServerConfigNameUniqueness(config = collectServerConfigFromForm()) {
  const duplicate = serverConfigs.find(
    (item) =>
      item.name.trim().toLowerCase() === config.name.trim().toLowerCase()
      && item.id !== (config.id || ""),
  );

  return duplicate
    ? `A saved config named "${config.name}" already exists. Choose a different name.`
    : "";
}

function updateServerActions() {
  const runButton = document.getElementById("runServerBtn");
  const saveButton = document.getElementById("saveServerConfigBtn");
  const previewButton = document.getElementById("previewServerConfigBtn");

  if (runButton) {
    runButton.disabled = false;
  }

  if (saveButton) {
    saveButton.disabled = false;
  }

  if (previewButton) {
    previewButton.disabled = false;
  }
}

function syncServerRadioButtons() {
  document.querySelectorAll('input[name="serverClubJsCss"]').forEach((input) => {
    input.checked = input.value === String(serverState.clubJsCss);
  });
  document.querySelectorAll('input[name="serverMinimize"]').forEach((input) => {
    input.checked = input.value === String(serverState.minimize);
  });
}

function renderServerForm(config = serverState) {
  serverState = createEmptyServerConfig(config);
  selectedServerConfigId = serverState.id || "";
  setServerInput("serverConfigName", serverState.name);
  setServerInput("serverPath", serverState.serverPath);
  setServerInput("serverRootPath", serverState.rootPath);
  syncServerRadioButtons();
  clearAllServerSuggestionLists();
  renderActiveServerConfig();
  renderServerDomains();
  renderServerVariations();
  setServerErrors([]);
  updateServerActions();
  saveWebviewState();
}

function renderServerView() {
  renderServerForm(serverState);
  renderServerConfigList();
}

function renderActiveServerConfig() {
  const container = document.getElementById("activeServerConfig");

  if (!container) {
    return;
  }

  if (!loadedServerConfigId) {
    container.classList.remove("hidden");
    container.innerHTML = '<strong>Unsaved config</strong> <code>New</code>';
    return;
  }

  container.classList.remove("hidden");
  container.innerHTML = `<strong>${escapeHtml(loadedServerConfigName || "Unnamed config")}</strong> <code>${escapeHtml(loadedServerConfigId)}</code>`;
}

function startNewServerConfig() {
  const preservedServerPath = serverState.serverPath || getServerInput("serverPath");
  serverState = createDefaultServerConfig();
  serverState.serverPath = preservedServerPath || "";
  selectedServerConfigId = "";
  resetLoadedServerConfigTracking();
  syncServerSearchInput("");
  isServerConfigDropdownOpen = false;
  renderServerView();
  renderActiveSummary();
  saveWebviewState();
  showToast("Started a new unsaved server config", "success");
}

function updateServerConfigSearch(value = "") {
  serverConfigSearchTerm = value;
  isServerConfigDropdownOpen =
    document.activeElement === document.getElementById("serverConfigSearch");
  renderServerConfigList();
}

function renderServerConfigList() {
  const container = document.getElementById("serverConfigList");
  const searchInput = document.getElementById("serverConfigSearch");
  const search = serverConfigSearchTerm.toLowerCase();

  if (!container) {
    return;
  }

  if (!isServerConfigDropdownOpen || document.activeElement !== searchInput) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  const matches = serverConfigs.filter((config) => {
    const text = [config.name, config.id, config.serverPath, config.rootPath]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return text.includes(search);
  });

  if (!matches.length) {
    container.classList.remove("hidden");
    container.innerHTML = '<div class="dropdown-empty">No saved configs</div>';
    return;
  }

  container.classList.remove("hidden");
  container.innerHTML = matches
    .slice(0, 5)
    .map(
      (config) => `
        <div class="saved-config-item ${config.id === selectedServerConfigId ? "active" : ""}">
          <button type="button" onmousedown="selectServerConfigOption(event, '${encodeURIComponent(config.id || "")}')">
            <span class="saved-config-option">
              <span>${escapeHtml(config.name || config.serverPath || "Untitled config")}</span>
              <code>${escapeHtml(config.id || "")}</code>
            </span>
          </button>
        </div>
      `,
    )
    .join("");
}

function openServerConfigDropdown() {
  serverConfigSearchTerm = getServerInput("serverConfigSearch");
  isServerConfigDropdownOpen = true;
  renderServerConfigList();
}

function closeServerConfigDropdown() {
  isServerConfigDropdownOpen = false;
  renderServerConfigList();
}

function loadServerConfig(encodedId) {
  const id = decodeURIComponent(encodedId || "");
  const config = serverConfigs.find((item) => item.id === id);

  if (!config) {
    showToast("Saved config not found", "error");
    return;
  }

  renderServerForm(config);
  syncServerSearchInput("");
  selectedServerConfigId = config.id || "";
  loadedServerConfigId = config.id || "";
  loadedServerConfigName = config.name || "";
  isServerConfigDropdownOpen = false;
  renderActiveServerConfig();
  renderServerConfigList();
  renderActiveSummary();
}

function selectServerConfigOption(event, encodedId) {
  if (event) {
    event.preventDefault();
  }

  loadServerConfig(encodedId);
}

function getServerSuggestionContainerId(field, variationId = "") {
  if (variationId) {
    return `serverSuggestions_${variationId}_${field}`;
  }

  return field === "serverPath"
    ? "serverPathSuggestions"
    : "serverRootPathSuggestions";
}

function clearServerSuggestionList(field, variationId = "") {
  const container = document.getElementById(
    getServerSuggestionContainerId(field, variationId),
  );

  if (!container) {
    return;
  }

  container.classList.add("hidden");
  container.innerHTML = "";
}

function clearAllServerSuggestionLists() {
  clearServerSuggestionList("serverPath");
  clearServerSuggestionList("rootPath");
  (serverState.variations || []).forEach((variation) => {
    clearServerSuggestionList("jsPath", variation.id);
    clearServerSuggestionList("cssPath", variation.id);
  });
}

function getServerSuggestionInputElement(field, variationId = "") {
  if (variationId) {
    return document.querySelector(
      `[data-server-variation-id="${variationId}"][data-server-field="${field}"]`,
    );
  }

  if (field === "serverPath") {
    return document.getElementById("serverPath");
  }

  if (field === "rootPath") {
    return document.getElementById("serverRootPath");
  }

  return null;
}

function hideServerSuggestionsOnBlur(field, variationId = "") {
  window.setTimeout(() => {
    const activeElement = document.activeElement;
    const container = document.getElementById(
      getServerSuggestionContainerId(field, variationId),
    );
    const input = getServerSuggestionInputElement(field, variationId);

    if (container && activeElement && container.contains(activeElement)) {
      return;
    }

    if (input && activeElement === input) {
      return;
    }

    clearServerSuggestionList(field, variationId);
  }, 120);
}

function renderServerSuggestionList(field, suggestions, variationId = "") {
  const container = document.getElementById(
    getServerSuggestionContainerId(field, variationId),
  );

  if (!container) {
    return;
  }

  if (!suggestions.length) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }

  container.classList.remove("hidden");
  container.innerHTML = suggestions
    .map(
      (suggestion) =>
        `<button type="button" class="suggestion-chip" title="${escapeHtml(suggestion.label)}" onclick="applyServerSuggestion('${encodeURIComponent(field || "")}', '${encodeURIComponent(suggestion.value || "")}', '${encodeURIComponent(variationId || "")}')">${escapeHtml(suggestion.label)}</button>`,
    )
    .join("");
}

function requestServerSuggestions(field, kind, variationId = "") {
  const currentValue =
    variationId && ["jsPath", "cssPath"].includes(field)
      ? serverState.variations.find((item) => item.id === variationId)?.[field] || ""
      : getServerInput(field === "rootPath" ? "serverRootPath" : field);

  vscode.postMessage({
    command: "getServerLocationSuggestions",
    field,
    kind,
    variationId,
    currentValue,
    basePath:
      variationId && ["jsPath", "cssPath"].includes(field)
        ? getServerInput("serverRootPath")
        : getServerInput("serverPath"),
  });
}

function collectServerActionErrors(config, options = {}) {
  const { includeDuplicateName = false } = options;
  const errors = validateServerForm(config);

  if (includeDuplicateName) {
    const duplicateNameError = validateServerConfigNameUniqueness(config);
    if (duplicateNameError) {
      errors.push(duplicateNameError);
    }
  }

  return errors;
}

function showServerActionErrors(actionLabel, errors, title) {
  setServerErrors(errors, title);
  showToast(`Complete the required server details before ${actionLabel}`, "error");
}

function applyServerSuggestion(encodedField, encodedValue, encodedVariationId = "") {
  const field = decodeURIComponent(encodedField || "");
  const value = decodeURIComponent(encodedValue || "");
  const variationId = decodeURIComponent(encodedVariationId || "");

  if (variationId && ["jsPath", "cssPath"].includes(field)) {
    updateServerVariation(variationId, field, value);
    renderServerVariations();
    clearServerSuggestionList(field, variationId);
  } else if (field === "serverPath") {
    setServerInput("serverPath", value);
    updateServerStateFromForm();
    clearServerSuggestionList("serverPath");
  } else if (field === "rootPath") {
    setServerInput("serverRootPath", value);
    updateServerStateFromForm();
    clearServerSuggestionList("rootPath");
  }

  renderActiveSummary();
}

function pickServerLocation(field, kind, variationId = "") {
  const currentValue =
    variationId && ["jsPath", "cssPath"].includes(field)
      ? serverState.variations.find((item) => item.id === variationId)?.[field] || ""
      : getServerInput(field === "rootPath" ? "serverRootPath" : field);

  vscode.postMessage({
    command: "pickServerLocation",
    field,
    kind,
    variationId,
    currentValue,
    basePath:
      variationId && ["jsPath", "cssPath"].includes(field)
        ? getServerInput("serverRootPath")
        : getServerInput("serverPath"),
  });
}

function renderServerDomains() {
  const container = document.getElementById("serverDomains");

  if (!container) {
    return;
  }

  const domains = serverState.domains?.length ? serverState.domains : [""];
  container.className = "domain-list";
  container.innerHTML = domains
    .map(
      (domain, index) => `
        <div class="domain-row">
          <input
            value="${escapeHtml(domain)}"
            placeholder="example.com"
            oninput="updateServerDomain(${index}, this.value)"
          />
          <button
            type="button"
            class="domain-remove"
            onclick="removeServerDomain(${index})"
            title="Remove domain"
          >
            x
          </button>
        </div>
      `,
    )
    .join("");
}

function addServerDomain() {
  const domains = serverState.domains || [];
  const hasEmptyDomain = domains.some((domain) => !String(domain || "").trim());

  if (hasEmptyDomain) {
    showToast("Fill the current empty domain before adding another one", "error");
    return;
  }

  serverState.domains = [...(serverState.domains || []), ""];
  renderServerDomains();
  updateServerActions();
  saveWebviewState();
}

function updateServerDomain(index, value) {
  if (!Array.isArray(serverState.domains)) {
    serverState.domains = [];
  }

  serverState.domains[index] = value;
  updateServerActions();
  saveWebviewState();
}

function removeServerDomain(index) {
  if (!Array.isArray(serverState.domains)) {
    serverState.domains = [];
  }

  serverState.domains = serverState.domains.filter((_, itemIndex) => itemIndex !== index);
  if (!serverState.domains.length) {
    serverState.domains = [""];
  }
  renderServerDomains();
  updateServerActions();
  saveWebviewState();
}

function renderServerVariations() {
  const container = document.getElementById("serverVariations");

  if (!container) {
    return;
  }

  if (!serverState.variations.length) {
    container.innerHTML = '<div class="dropdown-empty">No variations added</div>';
    return;
  }

  container.innerHTML = serverState.variations
    .map(
      (variation, index) => `
        <div class="variation-card">
          <div class="section">
            <label>Name</label>
            <input
              value="${escapeHtml(variation.name)}"
              oninput="updateServerVariation('${variation.id}', 'name', this.value)"
              placeholder="Variation ${index + 1}"
            />
          </div>
          <div class="section">
            <label>JS File Path</label>
            <div class="inline-field">
              <input
                value="${escapeHtml(variation.jsPath)}"
                oninput="updateServerVariation('${variation.id}', 'jsPath', this.value)"
                onfocus="requestServerSuggestions('jsPath', 'file', '${variation.id}')"
                onblur="hideServerSuggestionsOnBlur('jsPath', '${variation.id}')"
                data-server-field="jsPath"
                data-server-variation-id="${variation.id}"
                placeholder="/src/v1/v1.js"
              />
              <button
                type="button"
                class="secondary-button compact-button"
                onclick="pickServerLocation('jsPath', 'file', '${variation.id}')"
              >
                Browse
              </button>
            </div>
            <div id="serverSuggestions_${variation.id}_jsPath" class="path-suggestions hidden"></div>
          </div>
          <div class="section">
            <label>CSS File Path</label>
            <div class="inline-field">
              <input
                value="${escapeHtml(variation.cssPath)}"
                oninput="updateServerVariation('${variation.id}', 'cssPath', this.value)"
                onfocus="requestServerSuggestions('cssPath', 'file', '${variation.id}')"
                onblur="hideServerSuggestionsOnBlur('cssPath', '${variation.id}')"
                data-server-field="cssPath"
                data-server-variation-id="${variation.id}"
                placeholder="/src/components/file.css"
              />
              <button
                type="button"
                class="secondary-button compact-button"
                onclick="pickServerLocation('cssPath', 'file', '${variation.id}')"
              >
                Browse
              </button>
            </div>
            <div id="serverSuggestions_${variation.id}_cssPath" class="path-suggestions hidden"></div>
          </div>
          <button type="button" class="secondary-button" onclick="removeServerVariation('${variation.id}')">Remove Variation</button>
        </div>
      `,
    )
    .join("");
}

function updateServerStateFromForm() {
  serverState.name = getServerInput("serverConfigName");
  serverState.serverPath = getServerInput("serverPath");
  serverState.rootPath = getServerInput("serverRootPath");
  serverState.domains = (serverState.domains || []).map((domain) => String(domain || ""));
  updateServerActions();
  renderActiveServerConfig();
  renderActiveSummary();
  saveWebviewState();
}

function prepareServerConfigForPersist() {
  const config = collectServerConfigFromForm();
  const normalizedName = config.name.trim().toLowerCase();
  const normalizedLoadedName = loadedServerConfigName.trim().toLowerCase();
  const isRenamedLoadedConfig =
    Boolean(loadedServerConfigId)
    && Boolean(loadedServerConfigName)
    && normalizedName !== normalizedLoadedName;

  return {
    config: {
      ...config,
      id: isRenamedLoadedConfig ? "" : config.id,
    },
    isUpdatingExistingConfig:
      Boolean(loadedServerConfigId)
      && Boolean(loadedServerConfigName)
      && normalizedName === normalizedLoadedName,
  };
}

function updateServerToggle(field, value) {
  if (!["clubJsCss", "minimize"].includes(field)) {
    return;
  }

  serverState[field] = Boolean(value);
  updateServerActions();
  saveWebviewState();
}

function updateServerVariation(id, field, value) {
  const variation = serverState.variations.find((item) => item.id === id);

  if (variation && ["name", "jsPath", "cssPath"].includes(field)) {
    variation[field] = value;
    updateServerActions();
    saveWebviewState();
  }
}

function addServerVariation() {
  serverState.variations.push(createServerVariation());
  renderServerVariations();
  updateServerActions();
  saveWebviewState();
}

function removeServerVariation(id) {
  serverState.variations = serverState.variations.filter(
    (variation) => variation.id !== id,
  );
  renderServerVariations();
  updateServerActions();
  saveWebviewState();
}

function saveServerConfig() {
  const { config, isUpdatingExistingConfig } = prepareServerConfigForPersist();
  const errors = collectServerActionErrors(config, {
    includeDuplicateName: true,
  });

  if (errors.length) {
    showServerActionErrors(
      "saving this config",
      errors,
      "Unable to save server config:",
    );
    return;
  }

  const actionText = isUpdatingExistingConfig
    ? `Update saved config "${config.name}" (${loadedServerConfigId})?`
    : `Save "${config.name}" as a new server config?`;

  openModal(actionText, () => {
    vscode.postMessage({
      command: "saveServerConfig",
      config,
    });
  }, "Confirm Save");
}

function runServer() {
  const { config } = prepareServerConfigForPersist();
  const errors = collectServerActionErrors(config, {
    includeDuplicateName: true,
  });

  if (errors.length) {
    showServerActionErrors(
      "running the server",
      errors,
      "Unable to run the server with this config:",
    );
    return;
  }

  vscode.postMessage({
    command: "runServer",
    config,
  });
}

function previewServerConfig() {
  const { config } = prepareServerConfigForPersist();
  const errors = collectServerActionErrors(config);

  if (errors.length) {
    showServerActionErrors(
      "opening the config preview",
      errors,
      "Unable to preview this server config:",
    );
    return;
  }

  vscode.postMessage({
    command: "previewServerConfig",
    config,
  });
}

function openServerConfigClearModal() {
  document.getElementById("serverConfigClearModal").classList.remove("hidden");
}

function closeServerConfigClearModal() {
  document.getElementById("serverConfigClearModal").classList.add("hidden");
}

function clearCurrentServerConfig() {
  closeServerConfigClearModal();

  if (!selectedServerConfigId) {
    const preservedServerPath = serverState.serverPath || getServerInput("serverPath");
    serverState = createDefaultServerConfig();
    serverState.serverPath = preservedServerPath || "";
    selectedServerConfigId = "";
    renderServerView();
    renderActiveSummary();
    saveWebviewState();
    showToast("Cleared current server form", "success");
    return;
  }

  vscode.postMessage({
    command: "clearServerConfig",
    id: selectedServerConfigId,
  });
}

function clearAllServerConfigs() {
  closeServerConfigClearModal();
  vscode.postMessage({ command: "clearAllServerConfigs" });
}

window.addEventListener("message", ({ data }) => {
  if (data.type === "files") {
    if (isImageUploadActive() || isServerActive()) {
      return;
    }

    const session = getActiveSession();
    const existing = new Set(getSessionFiles(session).map((file) => file.fsPath));

    (data.files || []).forEach((file) => {
      if (existing.has(file.fsPath)) {
        return;
      }

      if (file.fsPath.toLowerCase().endsWith(".js")) {
        session.jsFiles.push(file);
      } else if (file.fsPath.toLowerCase().endsWith(".css")) {
        session.cssFiles.push(file);
      }
    });

    renderFiles(getSessionFiles(session));
    saveConfig();
    return;
  }

  switch (data.command) {
    case "restore": {
      const restored = data.data || {};
      const savedState = vscode.getState();

      authMode = savedState?.authMode || restored.authMode || "apikey";
      accounts = restored.accounts || savedState?.accounts || [];
      clientId = restored.clientId || savedState?.clientId || "";

      if (!savedState?.sessions?.length && restored.accountId) {
        const session = getActiveSession();
        session.accountId = restored.accountId || "";
        session.projectId = restored.projectId || null;
        session.experienceId = restored.experienceId || null;
        session.variationId = restored.variationId || null;
      }

      set("apiKey", authMode === "apikey" ? restored.apiKey || savedState?.apiKey || "" : "");
      renderSession();
      break;
    }

    case "accounts":
      accounts = data.data || [];
      renderAccounts();
      saveWebviewState();
      break;

    case "projects": {
      const session =
        data.sessionId === IMAGE_UPLOAD_SESSION_ID
          ? imageUploadState
          : sessions.find((item) => item.sessionId === data.sessionId) ||
            getActiveSession();
      session.projectItems = extractItems(data.data);
      if (
        (data.sessionId === IMAGE_UPLOAD_SESSION_ID && isImageUploadActive()) ||
        session.sessionId === activeSessionId
      ) {
        renderDropdown("projects", session.projectItems, selectProject, {
          selectedId: session.projectId,
          remoteSearch: true,
          collapseWhenSelected: isHydratingRestore,
        });
        if (isHydratingRestore && session.projectId) {
          if (!isImageUploadActive()) {
            requestExperiences(session.projectId);
          }
        } else {
          isHydratingRestore = false;
        }
      }
      saveWebviewState();
      break;
    }

    case "experiences": {
      const session = sessions.find((item) => item.sessionId === data.sessionId) || getActiveSession();
      session.experienceItems = extractItems(data.data);
      if (session.sessionId === activeSessionId) {
        renderDropdown("experiences", session.experienceItems, selectExperience, {
          selectedId: session.experienceId,
          remoteSearch: true,
          collapseWhenSelected: isHydratingRestore,
        });
        if (isHydratingRestore && session.experienceId) {
          requestVariations(session.experienceId);
        } else {
          isHydratingRestore = false;
        }
      }
      saveWebviewState();
      break;
    }

    case "variations": {
      const session = sessions.find((item) => item.sessionId === data.sessionId) || getActiveSession();
      session.variationItems = data.data || [];
      if (session.sessionId === activeSessionId) {
        renderDropdown("variations", session.variationItems, selectVariation, {
          selectedId: session.variationId,
          collapseWhenSelected: isHydratingRestore,
        });
        isHydratingRestore = false;
      }
      saveWebviewState();
      break;
    }

    case "editorOpened": {
      const session = sessions.find((item) => item.sessionId === data.sessionId);

      sessions.forEach((item) => {
        if (item.sessionId !== data.sessionId) {
          item.editorFiles = { js: "", css: "" };
        }
      });

      if (session) {
        session.editorFiles = data.files || { js: "", css: "" };
      }
      setEditorLoading(false);
      renderActiveSummary();
      saveConfig();
      showToast("Editor files opened", "success");
      break;
    }

    case "editorClosed": {
      const session = sessions.find((item) => item.sessionId === data.sessionId);

      if (session) {
        session.editorFiles = { js: "", css: "" };
      }

      setEditorLoading(false);
      renderActiveSummary();
      saveConfig();
      showToast("Editor files closed", "success");
      break;
    }

    case "imageSelected":
    case "imagesSelected":
      imageUploadState.multipleImages = (data.images || (data.image ? [data.image] : [])).map((image, index) => ({
        ...image,
        id: `${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
        imageName: image.baseName,
        status: "pending",
        cdnUrl: "",
        error: "",
      }));
      renderImageUploadView();
      saveWebviewState();
      break;

    case "success":
      setLoading(false);
      setEditorLoading(false);
      if (data.source === "upload") {
        const session =
          sessions.find((item) => item.sessionId === data.sessionId) ||
          getActiveSession();
        rememberUploadedFiles(session);
      }
      showToast(data.message || "Success", "success", 3000);
      break;

    case "imageUploaded":
      if (data.rowId) {
        const image = imageUploadState.multipleImages.find(
          (item) => item.id === data.rowId,
        );
        if (image) {
          image.status = "uploaded";
          image.cdnUrl = data.cdnUrl || "";
          image.error = "";
        }
        renderMultipleImageTable();
        saveWebviewState();
        uploadNextImage(getAuthPayload());
      }
      break;

    case "imageUploadFailed":
      if (data.rowId) {
        const image = imageUploadState.multipleImages.find(
          (item) => item.id === data.rowId,
        );
        if (image) {
          image.status = "failed";
          image.error = data.message || "Failed";
        }
        renderMultipleImageTable();
        saveWebviewState();
        uploadNextImage(getAuthPayload());
      }
      break;

    case "imageSelectionCancelled":
      setLoading(false);
      break;

    case "cdnUpdate":
      setTimeout(() => {
        showToast(`Next CDN Update: ${formatTimestamp(data.timestamp)}`, "success", 5000);
      }, 3000);
      break;

    case "error":
      setLoading(false);
      setEditorLoading(false);
      isHydratingRestore = false;
      showToast(data.message || "Something went wrong", "error");
      break;

    case "oauthSuccess":
      authMode = "oauth";
      accounts = data.accounts || [];
      updateAuthUI();

      if (accounts.length === 1) {
        selectAccount(String(accounts[0].id));
      } else {
        saveConfig();
      }

      showToast("Connected via Convert OAuth", "success");
      break;

    case "clientIdSaved":
      clientId = data.clientId || "";
      if (authMode === "oauth") {
        authMode = "apikey";
        accounts = [];
        getActiveProjectContext().accountId = "";
        set("accountId", "");
        clearDropdowns("accounts", "projects", "experiences", "variations");
        updateAuthUI();
        saveConfig();
      }
      closeClientIdModal();
      showToast(clientId ? "Client ID saved" : "Client ID cleared", "success");
      break;

    case "clientId":
      clientId = data.clientId || "";
      set("clientIdInput", clientId);
      saveWebviewState();
      break;

    case "oauthLogout":
      authMode = "apikey";
      accounts = [];
      getActiveProjectContext().accountId = "";
      set("accountId", "");
      clearDropdowns("accounts", "projects", "experiences", "variations");
      updateAuthUI();
      saveConfig();
      showToast("Disconnected", "success");
      break;

    case "clearedAll":
      resetFormState();
      showToast("Cleared all saved data", "success");
      break;

    case "serverConfigsLoaded":
      serverConfigs = data.configs || [];
      if (serverState.name) {
        const matchingCurrentConfig = serverState.id
          ? serverConfigs.find((config) => config.id === serverState.id)
          : null;
        const matchingByName = !matchingCurrentConfig
          ? serverConfigs.find(
            (config) =>
              config.name.trim().toLowerCase() === serverState.name.trim().toLowerCase(),
          )
          : null;
        const resolvedCurrentConfig = matchingCurrentConfig || matchingByName;

        if (resolvedCurrentConfig) {
          serverState = createEmptyServerConfig({
            ...serverState,
            id: resolvedCurrentConfig.id || "",
          });
          selectedServerConfigId = resolvedCurrentConfig.id || "";
          loadedServerConfigId = resolvedCurrentConfig.id || "";
          loadedServerConfigName = resolvedCurrentConfig.name || "";
        }
      }
      if (data.lastConfigId && !serverState.serverPath) {
        const lastConfig = serverConfigs.find((config) => config.id === data.lastConfigId);
        if (lastConfig) {
          serverState = createEmptyServerConfig(lastConfig);
          selectedServerConfigId = lastConfig.id || "";
          loadedServerConfigId = lastConfig.id || "";
          loadedServerConfigName = lastConfig.name || "";
        }
      }
      if (isServerActive()) {
        renderServerView();
      }
      break;

    case "serverConfigSaved":
      serverConfigs = data.configs || [];
      serverState = createEmptyServerConfig(data.config || serverState);
      selectedServerConfigId = serverState.id || "";
      loadedServerConfigId = serverState.id || "";
      loadedServerConfigName = serverState.name || "";
      syncServerSearchInput("");
      isServerConfigDropdownOpen = false;
      renderServerView();
      renderActiveSummary();
      showToast(data.message || "Server config saved", "success");
      break;

    case "serverLocationPicked": {
      const { field, path, variationId } = data;
      if (variationId && ["jsPath", "cssPath"].includes(field)) {
        updateServerVariation(variationId, field, path || "");
        renderServerVariations();
        clearServerSuggestionList(field, variationId);
      } else if (field === "serverPath") {
        setServerInput("serverPath", path || "");
        updateServerStateFromForm();
        clearServerSuggestionList("serverPath");
      } else if (field === "rootPath") {
        setServerInput("serverRootPath", path || "");
        updateServerStateFromForm();
        clearServerSuggestionList("rootPath");
      }
      renderActiveSummary();
      break;
    }

    case "serverLocationSuggestions":
      renderServerSuggestionList(
        data.field,
        data.suggestions || [],
        data.variationId || "",
      );
      break;

    case "serverValidationError":
      setServerErrors(
        data.errors || [data.message || "Server validation failed"],
        data.title || "Server validation failed",
      );
      showToast(data.message || "Server validation failed", "error");
      break;

    case "serverRunning":
      serverConfigs = data.configs || serverConfigs;
      serverState = createEmptyServerConfig(data.config || serverState);
      selectedServerConfigId = serverState.id || "";
      loadedServerConfigId = serverState.id || "";
      loadedServerConfigName = serverState.name || "";
      isServerConfigDropdownOpen = false;
      renderServerView();
      renderActiveSummary();
      showToast(data.message || "Server started", "success");
      break;

    case "serverConfigPreviewed":
      serverState = createEmptyServerConfig(data.config || serverState);
      selectedServerConfigId = serverState.id || "";
      loadedServerConfigId = serverState.id || "";
      loadedServerConfigName = serverState.name || "";
      isServerConfigDropdownOpen = false;
      renderServerView();
      renderActiveSummary();
      showToast(data.message || "Config preview opened", "success");
      break;

    case "serverConfigCleared":
      serverConfigs = data.configs || [];
      {
        const preservedServerPath = serverState.serverPath || getServerInput("serverPath");
        serverState = createDefaultServerConfig();
        serverState.serverPath = preservedServerPath || "";
      }
      selectedServerConfigId = "";
      resetLoadedServerConfigTracking();
      syncServerSearchInput("");
      isServerConfigDropdownOpen = false;
      renderServerView();
      renderActiveSummary();
      showToast(data.message || "Server config cleared", "success");
      break;

    case "allServerConfigsCleared":
      serverConfigs = [];
      {
        const preservedServerPath = serverState.serverPath || getServerInput("serverPath");
        serverState = createDefaultServerConfig();
        serverState.serverPath = preservedServerPath || "";
      }
      selectedServerConfigId = "";
      resetLoadedServerConfigTracking();
      syncServerSearchInput("");
      isServerConfigDropdownOpen = false;
      renderServerView();
      renderActiveSummary();
      showToast(data.message || "All server configs cleared", "success");
      break;
  }
});

function extractItems(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  return [];
}

function renderAccounts() {
  if (authMode !== "oauth") {
    return;
  }

  renderDropdown("accounts", accounts, selectAccount, {
    selectedId: accountId(),
    placeholder: accounts.length ? "Select account" : "No accounts available",
    remoteSearch: false,
    collapseWhenSelected: isHydratingRestore,
    startCollapsed: true,
  });
}

function renderDropdown(id, items, onSelect, options = {}) {
  const container = document.getElementById(id);
  container.innerHTML = "";

  const allItems = items || [];
  let filtered = [...allItems];
  const wrapper = document.createElement("div");
  const input = document.createElement("input");
  const list = document.createElement("div");

  input.className = "dropdown-input";
  input.placeholder =
    options.placeholder ||
    (id === "variations" ? "Type to filter..." : "Type to filter or press Enter");
  list.className = "dropdown-list";

  const selected = allItems.find((item) => String(item.id) === String(options.selectedId));
  if (selected) {
    input.value = selected.name;
  }

  const collapseWhenSelected = Boolean(options.collapseWhenSelected && selected);

  function renderList(data) {
    list.innerHTML = "";

    if (!data.length) {
      list.innerHTML = "<div class='dropdown-empty'>No results</div>";
      return;
    }

    data.slice(0, 5).forEach((item) => {
      const div = document.createElement("div");
      div.className =
        String(item.id) === String(options.selectedId)
          ? "dropdown-item selected"
          : "dropdown-item";
      div.innerText = item.name;
      div.onclick = () => {
        input.value = item.name;
        list.innerHTML = "";
        onSelect(String(item.id));
      };
      list.appendChild(div);
    });

    if (data.length > 5) {
      const more = document.createElement("div");
      more.className = "dropdown-more";
      more.innerText = `+ ${data.length - 5} more...`;
      list.appendChild(more);
    }
  }

  input.oninput = () => {
    const value = input.value.toLowerCase();
    filtered = allItems.filter((item) => item.name.toLowerCase().includes(value));
    renderList(filtered);
  };

  input.onfocus = () => {
    if (!list.innerHTML) {
      renderList(filtered);
    }
  };

  input.onkeydown = (event) => {
    if (event.key !== "Enter" || !options.remoteSearch) {
      return;
    }

    event.preventDefault();
    const auth = getAuthPayload();
    const session = getActiveProjectContext();
    if (auth === null) {
      return;
    }

    const search = input.value.trim();
    list.innerHTML = "<div class='dropdown-empty'>Searching...</div>";

    if (id === "projects") {
      vscode.postMessage({
        command: "getProjects",
        ...auth,
        sessionId: isImageUploadActive() ? IMAGE_UPLOAD_SESSION_ID : session.sessionId,
        accountId: session.accountId,
        search,
      });
    }

    if (id === "experiences") {
      if (!session.projectId) {
        showToast("Select project first", "error");
        return;
      }

      requestExperiences(session.projectId, search);
    }
  };

  wrapper.appendChild(input);
  wrapper.appendChild(list);
  container.appendChild(wrapper);
  if (!collapseWhenSelected && !options.startCollapsed) {
    renderList(filtered);
  }
}

function renderFiles(files) {
  const list = document.getElementById("filesList");

  if (!files.length) {
    list.innerHTML = '<div class="no-files">Drag files into drop zone below</div>';
    return;
  }

  list.innerHTML = "";
  files.forEach((file) => {
    const div = document.createElement("div");
    const fileInfo = document.createElement("div");
    const fileName = document.createElement("div");
    const filePath = document.createElement("div");
    const removeButton = document.createElement("button");

    div.className = "file-item";
    fileInfo.className = "file-info";
    fileName.className = "file-name";
    filePath.className = "file-path";
    fileName.textContent = formatFileLabel(file);
    filePath.textContent = file.fsPath;
    removeButton.title = "Remove";
    removeButton.textContent = "x";
    removeButton.onclick = () => removeFile(file.fsPath);

    fileInfo.appendChild(fileName);
    fileInfo.appendChild(filePath);
    div.appendChild(fileInfo);
    div.appendChild(removeButton);
    list.appendChild(div);
  });
}

function formatFileLabel(file) {
  const parts = file.fsPath.split(/[\\/]/).filter(Boolean);

  if (parts.length < 4) {
    return file.name;
  }

  return parts.slice(-4).join(" / ");
}

function removeFile(fsPath) {
  const session = getActiveSession();
  session.jsFiles = session.jsFiles.filter((file) => file.fsPath !== fsPath);
  session.cssFiles = session.cssFiles.filter((file) => file.fsPath !== fsPath);
  vscode.postMessage({ type: "remove", fsPath });
  renderFiles(getSessionFiles(session));
  saveConfig();
}

function openModal(text, callback, title = "Confirm Action") {
  document.getElementById("confirmTitle").innerText = title;
  document.getElementById("confirmText").innerText = text;
  document.getElementById("confirmModal").classList.remove("hidden");
  pendingSubmit = callback;
}

function openClientIdModal() {
  set("clientIdInput", clientId);
  document.getElementById("clientIdModal").classList.remove("hidden");
}

function closeClientIdModal() {
  document.getElementById("clientIdModal").classList.add("hidden");
}

function saveClientId() {
  vscode.postMessage({
    command: "saveClientId",
    clientId: get("clientIdInput"),
  });
}

function closeModal() {
  document.getElementById("confirmModal").classList.add("hidden");
  pendingSubmit = null;
}

function confirmSubmit() {
  if (pendingSubmit) {
    pendingSubmit();
  }
  closeModal();
}

document.getElementById("apiKey").addEventListener("input", saveConfig);
document.getElementById("accountId").addEventListener("input", () => {
  if (isServerActive()) {
    return;
  }

  getActiveProjectContext().accountId = get("accountId");
  saveConfig();
});
["serverConfigName", "serverPath", "serverRootPath"].forEach((id) => {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }

  element.addEventListener("input", updateServerStateFromForm);
  element.addEventListener("focus", closeServerConfigDropdown);
  if (id === "serverPath") {
    element.addEventListener("blur", () => hideServerSuggestionsOnBlur("serverPath"));
  }
  if (id === "serverRootPath") {
    element.addEventListener("blur", () => hideServerSuggestionsOnBlur("rootPath"));
  }
});
["click", "focus"].forEach((eventName) => {
  document.getElementById("serverPath").addEventListener(eventName, () => {
    requestServerSuggestions("serverPath", "folder");
  });
  document.getElementById("serverRootPath").addEventListener(eventName, () => {
    requestServerSuggestions("rootPath", "folder");
  });
});
document.getElementById("serverConfigSearch").addEventListener("blur", () => {
  setTimeout(() => {
    closeServerConfigDropdown();
  }, 120);
});

window.addSession = addSession;
window.switchSession = switchSession;
window.removeSession = removeSession;
window.switchServerTab = switchServerTab;
window.handleAuthBtn = handleAuthBtn;
window.openClientIdModal = openClientIdModal;
window.loadProjects = loadProjects;
window.clearAll = clearAll;
window.closeClearModal = closeClearModal;
window.clearProjectDetails = clearProjectDetails;
window.clearAllStoredData = clearAllStoredData;
window.submit = submit;
window.openEditor = openEditor;
window.pushEditor = pushEditor;
window.selectImages = selectImages;
window.uploadImages = uploadImages;
window.updateMultipleImageName = updateMultipleImageName;
window.requestClearImageUpload = requestClearImageUpload;
window.closeImageClearModal = closeImageClearModal;
window.confirmClearImageUpload = confirmClearImageUpload;
window.confirmSubmit = confirmSubmit;
window.closeModal = closeModal;
window.saveClientId = saveClientId;
window.closeClientIdModal = closeClientIdModal;
window.pickServerLocation = pickServerLocation;
window.loadServerConfig = loadServerConfig;
window.applyServerSuggestion = applyServerSuggestion;
window.requestServerSuggestions = requestServerSuggestions;
window.hideServerSuggestionsOnBlur = hideServerSuggestionsOnBlur;
window.updateServerToggle = updateServerToggle;
window.updateServerVariation = updateServerVariation;
window.addServerVariation = addServerVariation;
window.removeServerVariation = removeServerVariation;
window.addServerDomain = addServerDomain;
window.updateServerDomain = updateServerDomain;
window.removeServerDomain = removeServerDomain;
window.saveServerConfig = saveServerConfig;
window.previewServerConfig = previewServerConfig;
window.runServer = runServer;
window.renderServerConfigList = renderServerConfigList;
window.openServerConfigDropdown = openServerConfigDropdown;
window.updateServerConfigSearch = updateServerConfigSearch;
window.selectServerConfigOption = selectServerConfigOption;
window.openServerConfigClearModal = openServerConfigClearModal;
window.closeServerConfigClearModal = closeServerConfigClearModal;
window.clearCurrentServerConfig = clearCurrentServerConfig;
window.clearAllServerConfigs = clearAllServerConfigs;

initSessions();
