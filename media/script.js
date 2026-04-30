const vscode = acquireVsCodeApi();

const GLOBAL_VARIATION_ID = "global";
const IMAGE_UPLOAD_SESSION_ID = "__imageUpload";

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
    activeSessionId = session.sessionId;
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
    set("apiKey", saved.apiKey || "");
  } else {
    nextSessionNumber = 1;
    sessions = [createSession()];
    activeSessionId = sessions[0].sessionId;
  }

  renderSession();
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
}

function renderSession() {
  const context = getActiveProjectContext();

  renderTabs();
  set("accountId", context.accountId);
  updateAuthUI();
  renderDropdown("projects", context.projectItems, selectProject, {
    selectedId: context.projectId,
    remoteSearch: true,
    collapseWhenSelected: Boolean(context.projectId),
  });
  renderWorkflowMode();

  if (!isImageUploadActive()) {
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
  const workflowIds = [
    "experienceSection",
    "variationSection",
    "clearSection",
    "editorSection",
    "filesSection",
  ];

  workflowIds.forEach((id) => {
    document.getElementById(id).style.display = imageMode ? "none" : "block";
  });

  document.querySelectorAll(".workflow-only").forEach((element) => {
    element.style.display = imageMode ? "none" : "block";
  });

  document.getElementById("imageUploadView").classList.toggle("hidden", !imageMode);
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

window.addEventListener("message", ({ data }) => {
  if (data.type === "files") {
    if (isImageUploadActive()) {
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

function openModal(text, callback) {
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
  getActiveProjectContext().accountId = get("accountId");
  saveConfig();
});

window.addSession = addSession;
window.switchSession = switchSession;
window.removeSession = removeSession;
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

initSessions();
