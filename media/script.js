const vscode = acquireVsCodeApi();

let selectedProject = null;
let selectedExperience = null;
let selectedVariation = null;
let authMode = "apikey";
let isGlobal = false;
let isLoading = false;
let accounts = [];
let clientId = "";
let isHydratingRestore = false;
let toastTimer = null;
let pendingSubmit = null;

function get(id) {
  return document.getElementById(id).value.trim();
}

function set(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.value = value || "";
  }
}

function accountId() {
  return get("accountId");
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
  document.getElementById("btnText").innerText = state
    ? "Pushing..."
    : "Push to Convert";
  document.getElementById("btnLoader").style.display = state
    ? "inline-block"
    : "none";
}

function updateAuthUI() {
  const isOauth = authMode === "oauth";

  document.getElementById("apiKeySection").style.display = isOauth
    ? "none"
    : "block";
  document.getElementById("oauthSection").style.display = isOauth
    ? "block"
    : "none";
  document.getElementById("orSeparator").style.display = isOauth
    ? "none"
    : "flex";
  document.getElementById("accountIdSection").style.display = isOauth
    ? "none"
    : "block";
  document.getElementById("accountSelectSection").style.display = isOauth
    ? "block"
    : "none";
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

function saveConfig() {
  vscode.postMessage({
    command: "saveConfig",
    data: {
      apiKey: authMode === "apikey" ? get("apiKey") : null,
      accountId: accountId(),
      projectId: selectedProject,
      experienceId: selectedExperience,
      variationId: selectedVariation,
      authMode,
    },
  });
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
  selectedProject = null;
  selectedExperience = null;
  selectedVariation = null;
  isGlobal = false;
  isHydratingRestore = false;
  setLoading(false);
  set("apiKey", "");
  set("accountId", "");
  set("clientIdInput", "");
  clearDropdowns("accounts", "projects", "experiences", "variations");
  renderFiles([]);
  updateAuthUI();
}

function clearAll() {
  vscode.postMessage({ command: "clearAll" });
}

function selectAccount(id) {
  if (accountId() !== id) {
    selectedProject = null;
    selectedExperience = null;
    selectedVariation = null;
    isGlobal = false;
    clearDropdowns("projects", "experiences", "variations");
  }

  set("accountId", id);
  saveConfig();
}

function loadProjects() {
  const auth = getAuthPayload();
  if (auth === null) {
    return;
  }

  if (!accountId()) {
    showToast("Account required", "error");
    return;
  }

  isHydratingRestore = Boolean(selectedProject);

  vscode.postMessage({
    command: "getProjects",
    ...auth,
    accountId: accountId(),
  });
}

function requestExperiences(projectId, search = "") {
  const auth = getAuthPayload();
  if (auth === null) {
    return;
  }

  vscode.postMessage({
    command: "getExperiences",
    ...auth,
    accountId: accountId(),
    projectId,
    search,
  });
}

function requestVariations(experienceId) {
  const auth = getAuthPayload();
  if (auth === null) {
    return;
  }

  vscode.postMessage({
    command: "getVariations",
    ...auth,
    accountId: accountId(),
    projectId: selectedProject,
    experienceId,
  });
}

function selectProject(id) {
  if (selectedProject !== id) {
    selectedExperience = null;
    selectedVariation = null;
    isGlobal = false;
    clearDropdowns("experiences", "variations");
  }

  selectedProject = id;
  saveConfig();
  requestExperiences(id);
}

function selectExperience(id) {
  if (selectedExperience !== id) {
    selectedVariation = null;
    isGlobal = false;
    clearDropdowns("variations");
  }

  selectedExperience = id;
  saveConfig();
  requestVariations(id);
}

function selectVariation(id) {
  selectedVariation = id;
  isGlobal = id === "global";
  saveConfig();
}

function validateBeforeSubmit() {
  if (authMode === "apikey" && !get("apiKey")) {
    return "API Key required";
  }
  if (!accountId()) {
    return "Account required";
  }
  if (!selectedProject) {
    return "Select project";
  }
  if (!selectedExperience) {
    return "Select experiment";
  }
  if (!selectedVariation) {
    return "Select variation";
  }
  return null;
}

function submit() {
  const error = validateBeforeSubmit();
  if (error) {
    showToast(error, "error");
    return;
  }

  if (isLoading) {
    return;
  }

  const target = isGlobal ? "Global JS and CSS" : "selected variation";
  openModal(`Push code to ${target}?`, () => executeSubmit());
}

function executeSubmit() {
  const auth = getAuthPayload();
  if (auth === null) {
    return;
  }

  setLoading(true);

  vscode.postMessage({
    command: isGlobal ? "submitGlobal" : "submitVariation",
    ...auth,
    accountId: accountId(),
    projectId: selectedProject,
    experienceId: selectedExperience,
    variationId: selectedVariation,
  });
}

window.addEventListener("message", ({ data }) => {
  if (data.type === "files") {
    renderFiles(data.files);
    return;
  }

  switch (data.command) {
    case "restore": {
      const restored = data.data || {};

      authMode = restored.authMode || "apikey";
      accounts = restored.accounts || [];
      clientId = restored.clientId || "";
      selectedProject = restored.projectId || null;
      selectedExperience = restored.experienceId || null;
      selectedVariation = restored.variationId || null;
      isGlobal = selectedVariation === "global";

      set("accountId", restored.accountId);
      set("apiKey", authMode === "apikey" ? restored.apiKey : "");
      updateAuthUI();
      break;
    }

    case "accounts":
      accounts = data.data || [];
      renderAccounts();
      break;

    case "projects":
      renderDropdown("projects", extractItems(data.data), selectProject, {
        selectedId: selectedProject,
        remoteSearch: true,
        collapseWhenSelected: isHydratingRestore,
      });
      if (isHydratingRestore && selectedProject) {
        requestExperiences(selectedProject);
      } else {
        isHydratingRestore = false;
      }
      break;

    case "experiences":
      renderDropdown("experiences", extractItems(data.data), selectExperience, {
        selectedId: selectedExperience,
        remoteSearch: true,
        collapseWhenSelected: isHydratingRestore,
      });
      if (isHydratingRestore && selectedExperience) {
        requestVariations(selectedExperience);
      } else {
        isHydratingRestore = false;
      }
      break;

    case "variations":
      renderDropdown("variations", data.data || [], selectVariation, {
        selectedId: selectedVariation,
        collapseWhenSelected: isHydratingRestore,
      });
      isHydratingRestore = false;
      break;

    case "success":
      setLoading(false);
      showToast(data.message || "Success", "success", 3000);
      break;

    case "cdnUpdate":
      setTimeout(() => {
        showToast(
          `Next CDN Update: ${formatTimestamp(data.timestamp)}`,
          "success",
          5000,
        );
      }, 3000);
      break;

    case "error":
      setLoading(false);
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
        set("accountId", "");
        selectedProject = null;
        selectedExperience = null;
        selectedVariation = null;
        isGlobal = false;
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
      break;

    case "oauthLogout":
      authMode = "apikey";
      accounts = [];
      set("accountId", "");
      selectedProject = null;
      selectedExperience = null;
      selectedVariation = null;
      isGlobal = false;
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
  });
}

function renderDropdown(id, items, onSelect, options = {}) {
  const container = document.getElementById(id);
  container.innerHTML = "";

  const allItems = items || [];
  let filtered = [...allItems];

  const wrapper = document.createElement("div");
  const input = document.createElement("input");
  input.className = "dropdown-input";
  input.placeholder =
    options.placeholder ||
    (id === "variations" ? "Type to filter..." : "Type to filter or press Enter");

  const selected = allItems.find(
    (item) => String(item.id) === String(options.selectedId),
  );
  if (selected) {
    input.value = selected.name;
  }

  const list = document.createElement("div");
  list.className = "dropdown-list";
  const collapseWhenSelected = Boolean(options.collapseWhenSelected && selected);

  function renderList(data) {
    list.innerHTML = "";

    if (!data.length) {
      list.innerHTML = "<div class='dropdown-empty'>No results</div>";
      return;
    }

    data.slice(0, 20).forEach((item) => {
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

    if (data.length > 20) {
      const more = document.createElement("div");
      more.className = "dropdown-more";
      more.innerText = `+ ${data.length - 20} more...`;
      list.appendChild(more);
    }
  }

  input.oninput = () => {
    const value = input.value.toLowerCase();
    filtered = allItems.filter((item) =>
      item.name.toLowerCase().includes(value),
    );
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
    if (auth === null) {
      return;
    }

    const search = input.value.trim();
    list.innerHTML = "<div class='dropdown-empty'>Searching...</div>";

    if (id === "projects") {
      vscode.postMessage({
        command: "getProjects",
        ...auth,
        accountId: accountId(),
        search,
      });
    }

    if (id === "experiences") {
      if (!selectedProject) {
        showToast("Select project first", "error");
        return;
      }

      requestExperiences(selectedProject, search);
    }
  };

  wrapper.appendChild(input);
  wrapper.appendChild(list);
  container.appendChild(wrapper);
  if (!collapseWhenSelected) {
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
    div.className = "file-item";
    const fileInfo = document.createElement("div");
    const fileName = document.createElement("div");
    const filePath = document.createElement("div");
    const removeButton = document.createElement("button");

    fileInfo.className = "file-info";
    fileName.className = "file-name";
    filePath.className = "file-path";
    fileName.textContent = file.name;
    filePath.textContent = file.fsPath;
    removeButton.title = "Remove";
    removeButton.textContent = "x";
    removeButton.onclick = () => {
      vscode.postMessage({ type: "remove", fsPath: file.fsPath });
    };

    fileInfo.appendChild(fileName);
    fileInfo.appendChild(filePath);
    div.appendChild(fileInfo);
    div.appendChild(removeButton);
    list.appendChild(div);
  });
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
document.getElementById("accountId").addEventListener("input", saveConfig);
