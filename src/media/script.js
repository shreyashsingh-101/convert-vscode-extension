const vscode = acquireVsCodeApi();

let selectedProject = null;
let selectedExperience = null;
let selectedVariation = null;

function validateBeforeSubmit() {
  if (!get("apiKey")) return "API Key required";
  if (!get("accountId")) return "Account ID required";
  if (!selectedProject) return "Select project";
  if (!selectedExperience) return "Select experiment";
  if (!selectedVariation) return "Select variation";

  return null;
}

function set(id, value) {
  if (value) document.getElementById(id).value = value;
}

function showToast(msg, type = "success") {
  const el = document.getElementById("toast");
  el.innerText = msg;
  el.className = `toast ${type}`;
  el.style.display = "block";

  setTimeout(() => {
    el.style.display = "none";
  }, 3000);
}

// ---------- MESSAGE LISTENER ----------
window.addEventListener("message", ({ data }) => {
  if (data.type === "files") {
    renderFiles(data.files);
    return;
  }

  switch (data.command) {
    case "restore":
      console.log("📥 Restore received:", data);

      if (!data) return;

      set("apiKey", data.apiKey);
      set("accountId", data.accountId);

      selectedProject = data.projectId || null;
      selectedExperience = data.experienceId || null;
      selectedVariation = data.variationId || null;

      break;
    case "projects":
      renderDropdown(
        "projects",
        data.data.data,
        selectProject,
        selectedProject,
      );
      break;

    case "experiences":
      renderDropdown(
        "experiences",
        data.data.data,
        selectExperience,
        selectedExperience,
      );
      break;

    case "variations":
      renderDropdown(
        "variations",
        data.data,
        selectVariation,
        selectedVariation,
      );
      break;

    case "error":
      showToast(data.message, "error");
      break;

    case "success":
      showToast(data.message, "success");
      break;
  }
});

// ---------- FILE UI ----------
function renderFiles(files) {
  const list = document.getElementById("filesList");

  if (!files.length) {
    list.innerHTML =
      '<div class="no-files">Drag files into drop zone below</div>';
    return;
  }

  list.innerHTML = "";

  files.forEach((file) => {
    const div = document.createElement("div");
    div.className = "file-item";

    div.innerHTML = `
      <span class="file-name">${file.name}</span>
      <button>✕</button>
    `;

    div.querySelector("button").onclick = () => {
      vscode.postMessage({ type: "remove", fsPath: file.fsPath });
    };

    list.appendChild(div);
  });
}

// ---------- API FLOW ----------
function loadProjects() {
  vscode.postMessage({
    command: "getProjects",
    apiKey: get("apiKey"),
    accountId: get("accountId"),
  });
}

function selectProject(id) {
  selectedProject = id;
  saveConfig();

  vscode.postMessage({
    command: "getExperiences",
    apiKey: get("apiKey"),
    accountId: get("accountId"),
    projectId: id,
  });
}

function selectExperience(id) {
  selectedExperience = id;
  saveConfig();

  vscode.postMessage({
    command: "getVariations",
    apiKey: get("apiKey"),
    accountId: get("accountId"),
    projectId: selectedProject,
    experienceId: id,
  });
}

function selectVariation(id) {
  selectedVariation = id;
  saveConfig();
}

// ---------- SUBMIT ----------
function submit() {
  const error = validateBeforeSubmit();
  if (error) {
    showToast(error, "error");
    return;
  }

  vscode.postMessage({
    command: "submit",
    apiKey: get("apiKey"),
    accountId: get("accountId"),
    projectId: selectedProject,
    experienceId: selectedExperience,
    variationId: selectedVariation,
  });
}

// ---------- UTILS ----------
function get(id) {
  return document.getElementById(id).value;
}

function saveConfig() {
  vscode.postMessage({
    command: "saveConfig",
    data: {
      apiKey: get("apiKey"),
      accountId: get("accountId"),
      projectId: selectedProject,
      experienceId: selectedExperience,
      variationId: selectedVariation,
    },
  });
}

document.getElementById("apiKey").addEventListener("input", () => {
  console.log("✏️ API key changed");
  saveConfig();
});

document.getElementById("accountId").addEventListener("input", () => {
  console.log("✏️ Account ID changed");
  saveConfig();
});


function renderDropdown(id, items, onSelect, selectedId = null) {
  const container = document.getElementById(id);
  container.innerHTML = "";

  const wrapper = document.createElement("div");

  const input = document.createElement("input");
  input.placeholder = "Search...";
  input.className = "dropdown-input";

  const list = document.createElement("div");
  list.className = "dropdown-list";

  function renderList(data) {
    list.innerHTML = "";

    if (!data.length) {
      list.innerHTML = `<div class="dropdown-empty">No results</div>`;
      return;
    }

    data.slice(0, 50).forEach(item => {
      const div = document.createElement("div");
      div.className = "dropdown-item";

      div.innerText = item.name;

      if (item.id == selectedId) {
        div.classList.add("selected");
        input.value = item.name;
      }

      div.onclick = () => {
        input.value = item.name;
        list.innerHTML = "";
        onSelect(item.id);
      };

      list.appendChild(div);
    });
  }

  input.onfocus = () => renderList(items);

  input.oninput = () => {
    const val = input.value.toLowerCase();
    const filtered = items.filter(i =>
      i.name.toLowerCase().includes(val)
    );
    renderList(filtered);
  };

  wrapper.appendChild(input);
  wrapper.appendChild(list);
  container.appendChild(wrapper);

  renderList(items);
}


window.addEventListener("load", () => {
  console.log("Webview loaded → requesting config");
  vscode.postMessage({ command: "getConfig" });
});