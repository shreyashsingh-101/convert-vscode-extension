const vscode = acquireVsCodeApi();
console.log("✅ script.js loaded");

let apiKey = "";
let selectedProject = null;
let selectedExperience = null;
let selectedVariation = null;

const list = document.getElementById("file-list");
const hint = document.getElementById("hint");

// ---------- MESSAGE LISTENER ----------
window.addEventListener("message", ({ data }) => {
  console.log("📨 Webview received message:", data.type || data.command);

  if (data.type === "files") {
    console.log("📁 Rendering files:", data.files.length);
    renderFiles(data.files);
    return;
  }

  switch (data.command) {
    case "projects":
      console.log("📊 Rendering projects");
      renderDropdown("projects", data.data.data, selectProject);
      break;

    case "experiences":
      console.log("🔬 Rendering experiences");
      renderDropdown("experiences", data.data.data, selectExperience);
      break;

    case "variations":
      console.log("🎨 Rendering variations");
      renderDropdown("variations", data.data, selectVariation);
      break;

    case "error":
      console.error("❌ Error:", data.message);
      alert("Error: " + data.message);
      break;

    case "success":
      console.log("✅ Success:", data.message);
      alert(data.message);
      break;
  }
});

// ---------- FILE RENDERING ----------
function renderFiles(files) {
  list.innerHTML = "";
  hint.classList.toggle("visible", files.length === 0);

  files.forEach((file) => {
    const item = document.createElement("div");
    item.className = "file-item";
    item.innerHTML = `
      <div style="flex:1;min-width:0">
        <div class="file-name">${file.name}</div>
        <div class="file-path">${file.fsPath}</div>
      </div>
      <button class="remove-btn" title="Remove" data-path="${file.fsPath}">✕</button>
    `;
    item.querySelector(".remove-btn").addEventListener("click", () => {
      console.log("🗑️ Removing file:", file.fsPath);
      vscode.postMessage({ type: "remove", fsPath: file.fsPath });
    });
    list.appendChild(item);
  });
}

// ---------- API FUNCTIONS ----------
function loadProjects() {
  const apiKeyVal = document.getElementById("apiKey").value;
  const accountId = document.getElementById("accountId").value;

  if (!apiKeyVal || !accountId) {
    alert("API Key and Account ID required");
    return;
  }

  console.log("📊 Loading projects...");
  vscode.postMessage({
    command: "getProjects",
    apiKey: apiKeyVal,
    accountId,
  });
}

function selectProject(id) {
  selectedProject = id;
  console.log("✅ Selected project:", id);
  vscode.postMessage({
    command: "getExperiences",
    apiKey: document.getElementById("apiKey").value,
    accountId: document.getElementById("accountId").value,
    projectId: id,
  });
}

function selectExperience(id) {
  selectedExperience = id;
  console.log("✅ Selected experience:", id);
  vscode.postMessage({
    command: "getVariations",
    apiKey: document.getElementById("apiKey").value,
    accountId: document.getElementById("accountId").value,
    projectId: selectedProject,
    experienceId: id,
  });
}

function selectVariation(id) {
  selectedVariation = id;
  console.log("✅ Selected variation:", id);
}

// ---------- FILE ACTIONS ----------
function clear() {
  console.log("🗑️ Clearing all files");
  vscode.postMessage({ type: "clear" });
}

function submit() {
  console.log("📤 Submitting...");
  const apiKeyVal = document.getElementById("apiKey").value;
  const accountId = document.getElementById("accountId").value;

  if (!apiKeyVal || !accountId) {
    alert("API Key and Account ID required");
    return;
  }

  if (!selectedVariation) {
    alert("Please select a variation");
    return;
  }

  vscode.postMessage({
    command: "submit",
    apiKey: apiKeyVal,
    accountId,
    variationId: selectedVariation,
  });
}

// ---------- DROPDOWN RENDERING ----------
function renderDropdown(id, items, onSelect) {
  const container = document.getElementById(id);
  container.innerHTML = "";

  if (!items || items.length === 0) {
    container.innerHTML = '<div class="dropdown">No items available</div>';
    return;
  }

  const select = document.createElement("select");
  select.innerHTML =
    '<option value="">-- Select --</option>' +
    items
      .map((item) => `<option value="${item.id}">${item.name}</option>`)
      .join("");

  select.addEventListener("change", (e) => {
    if (e.target.value) {
      onSelect(e.target.value);
    }
  });

  container.innerHTML = "";
  container.appendChild(select);
}
