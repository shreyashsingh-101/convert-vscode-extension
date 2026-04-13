const vscode = acquireVsCodeApi();

let apiKey = "";
let selectedProject = null;
let selectedExperience = null;
let selectedVariation = null;

// 🔑 API key input
function loadProjects() {
  apiKey = document.getElementById("apiKey").value;
  const accountId = document.getElementById("accountId").value;

  console.log("➡️ Fetching projects", { apiKey, accountId });

  vscode.postMessage({
    command: "getProjects",
    apiKey,
    accountId
  });
}

// 📦 Project select
function selectProject(id) {
  selectedProject = id;

  vscode.postMessage({
    command: "getExperiences",
    apiKey,
    accountId: document.getElementById("accountId").value,
    projectId: id
  });
}

// 🧪 Experience select
function selectExperience(id) {
  selectedExperience = id;

  vscode.postMessage({
    command: "getVariations",
    apiKey,
    accountId: document.getElementById("accountId").value,
    projectId: selectedProject,
    experienceId: id,
  });
}

// 🔀 Variation select
function selectVariation(id) {
  selectedVariation = id;
}

// 🎧 Listen for responses
window.addEventListener("message", (event) => {
  const message = event.data;

  console.log("⬅️ Received message", message);
  switch (message.command) {
    case "projects":
      renderDropdown("projects", message.data.data, selectProject);
      break;

    case "experiences":
      renderDropdown("experiences", message.data.data, selectExperience);
      break;

    case "variations":
      renderDropdown("variations", message.data, selectVariation);
      break;
  }
});

// 🎨 Generic dropdown renderer
function renderDropdown(id, items, onSelect) {
  const container = document.getElementById(id);
  container.innerHTML = "";

  if (!Array.isArray(items)) {
    console.error("Expected array, got:", items);
    return;
  }

  items.forEach(item => {
    const div = document.createElement("div");

    div.innerText = `${item.name} (${item.id})`; // 🔥 show both
    div.className = "dropdown-item";

    div.onclick = () => onSelect(item.id);

    container.appendChild(div);
  });
}