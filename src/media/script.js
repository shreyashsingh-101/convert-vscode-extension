const vscode = acquireVsCodeApi();

let selectedProject = null;
let selectedExperience = null;
let selectedVariation = null;
let isLoading = false;

const DROPDOWN_LIMIT = 5;

function setLoading(state) {
  isLoading = state;

  const btn = document.getElementById("submitBtn");
  const text = document.getElementById("btnText");
  const loader = document.getElementById("btnLoader");

  if (state) {
    btn.disabled = true;
    text.innerText = "Pushing...";
    loader.style.display = "inline-block";
  } else {
    btn.disabled = false;
    text.innerText = "Push to Convert";
    loader.style.display = "none";
  }
}

function validateBeforeSubmit() {
  if (!get("apiKey")) {return "API Key required";}
  if (!get("accountId")) {return "Account ID required";}
  if (!selectedProject) {return "Select project";}
  if (!selectedExperience) {return "Select experiment";}
  if (!selectedVariation) {return "Select variation";}

  return null;
}

function set(id, value) {
  if (value) {
    document.getElementById(id).value = value;
  }
}

let toastTimer = null;

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `toast visible ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = "toast";
  }, 3500);
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

      if (!data) {return;}

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

    case "success":
      setLoading(false);
      showToast(data.message || "Success", "success");
      break;

    case "error":
      setLoading(false);
      showToast(data.message || "Something went wrong", "error");
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
      <div class="file-info">
        <div class="file-name">${file.name}</div>
        <div class="file-path">${file.fsPath}</div>
      </div>
      <button title="Remove" data-path="${file.fsPath}">✕</button>
    `;

    div.querySelector("button").onclick = () => {
      vscode.postMessage({ type: "remove", fsPath: file.fsPath });
    };

    list.appendChild(div);
  });
}

// ---------- API FLOW ----------
function loadProjects() {
  const apiKeyVal = document.getElementById("apiKey").value.trim();
  const accountId = document.getElementById("accountId").value.trim();

  if (!apiKeyVal || !accountId) {
    showToast("API Key and Account ID are required", "error");
    return;
  }
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
  const apiKeyVal = document.getElementById("apiKey").value.trim();
  const accountId = document.getElementById("accountId").value.trim();

  if (!apiKeyVal || !accountId) {
    showToast("API Key and Account ID are required", "error");
    return;
  }
  if (!selectedProject) {
    showToast("Please select a project", "error");
    return;
  }
  if (!selectedExperience) {
    showToast("Please select an experiment", "error");
    return;
  }
  if (!selectedVariation) {
    showToast("Please select a variation", "error");
    return;
  }

  if (isLoading) {
    return;
  }

  const error = validateBeforeSubmit();
  if (error) {
    showToast(error, "error");
    return;
  }

  setLoading(true);

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

  const visibleItems = data.slice(0, DROPDOWN_LIMIT);

  visibleItems.forEach(item => {
    const div = document.createElement("div");
    div.className = "dropdown-item";
    div.innerText = item.name;

    div.onclick = () => {
      input.value = item.name;
      list.innerHTML = "";
      onSelect(item.id);
    };

    list.appendChild(div);
  });

 
  if (data.length > DROPDOWN_LIMIT) {
    const more = document.createElement("div");
    more.className = "dropdown-more";
    more.innerText = `+ ${data.length - DROPDOWN_LIMIT} more...`;
    list.appendChild(more);
  }
}

  input.onfocus = () => renderList(items);

  input.oninput = () => {
    const val = input.value.toLowerCase();

    // 🔥 if user clears input → clear selection
    if (!val) {
      selectedProject = null;
      selectedExperience = null;
      selectedVariation = null;

      saveConfig();
    }

    const filtered = items.filter((i) => i.name.toLowerCase().includes(val));

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
