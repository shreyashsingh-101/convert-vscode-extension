const vscode = acquireVsCodeApi();

const steps = [
  "Basic info",
  "Location",
  "Audience",
  "Goals",
  "Variations",
  "Review",
  "Success",
];

const LOCATION_URL_OPERATORS = [
  { value: "matches", label: "Matches exactly" },
  { value: "contains", label: "Contains" },
  { value: "startsWith", label: "Starts with" },
  { value: "endsWith", label: "Ends with" },
  { value: "regexMatches", label: "Regex matches" },
];

const LOCATION_JS_OPERATORS = [{ value: "equals", label: "Returns true" }];
const SEARCH_COMMANDS = {
  locations: "requestLocations",
  audiences: "requestAudiences",
  goals: "requestGoals",
};

let currentStep = 0;
let loading = false;
let project = { accountId: "", projectId: "", projectName: "" };
let successExperiment = null;
let locationSearch = "";
let audienceSearch = "";
let goalSearch = "";
let availableLocations = [];
let availableAudiences = [];
let availableGoals = [];
let expandedDetails = {};
let state = createInitialState();

function getFocusableSnapshot() {
  const active = document.activeElement;
  if (
    !(active instanceof HTMLInputElement) &&
    !(active instanceof HTMLTextAreaElement) &&
    !(active instanceof HTMLSelectElement)
  ) {
    return null;
  }

  const attributes = [
    "data-field",
    "data-search-field",
    "data-new-location-id",
    "data-new-location-field",
    "data-new-goal-id",
    "data-new-goal-field",
    "data-new-variation-id",
    "data-new-variation-field",
  ];
  const selectorParts = [];

  for (const attribute of attributes) {
    const value = active.getAttribute(attribute);
    if (value !== null) {
      selectorParts.push(`[${attribute}="${CSS.escape(value)}"]`);
    }
  }

  if (!selectorParts.length) {
    return null;
  }

  return {
    selector: `${active.tagName.toLowerCase()}${selectorParts.join("")}`,
    selectionStart:
      active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
        ? active.selectionStart
        : null,
    selectionEnd:
      active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
        ? active.selectionEnd
        : null,
  };
}

function restoreFocusableSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  const element = document.querySelector(snapshot.selector);
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLTextAreaElement) &&
    !(element instanceof HTMLSelectElement)
  ) {
    return;
  }

  element.focus();
  if (
    snapshot.selectionStart !== null &&
    snapshot.selectionEnd !== null &&
    (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)
  ) {
    element.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
  }
}

function createInitialState() {
  return {
    name: "",
    url: "",
    description: "",
    selectedLocations: [],
    newLocations: [],
    audiences: [],
    goals: [],
    newGoals: [],
    variationNames: [createVariationDraft("Variation 1")],
  };
}

function stripUrlProtocol(value) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\/+/, "");
}

function getNormalizedExperimentUrl(value = state.url) {
  const stripped = stripUrlProtocol(value);
  return stripped ? `https://${stripped}` : "";
}

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function createVariationDraft(name = "") {
  return {
    draftId: createId("variation"),
    name,
  };
}

function post(command, payload = {}) {
  vscode.postMessage({ command, ...payload });
}

function isSuccessStep() {
  return currentStep === steps.length - 1;
}

function updateField(field, value) {
  state[field] = field === "url" ? stripUrlProtocol(value) : value;
}

function setSearch(field, value) {
  if (field === "locations") {
    locationSearch = value;
    return;
  }

  if (field === "audiences") {
    audienceSearch = value;
    return;
  }

  if (field === "goals") {
    goalSearch = value;
  }
}

function getSearchValue(field) {
  if (field === "locations") {
    return locationSearch;
  }

  if (field === "audiences") {
    return audienceSearch;
  }

  return goalSearch;
}

function requestSearch(field) {
  const command = SEARCH_COMMANDS[field];
  if (!command) {
    return;
  }

  post(command, { search: getSearchValue(field).trim() });
}

function toggleSelectedItem(collection, item) {
  const selected = state[collection].some((entry) => String(entry.id) === String(item.id));
  state[collection] = selected
    ? state[collection].filter((entry) => String(entry.id) !== String(item.id))
    : [...state[collection], item];
  render();
}

function detailKey(collection, id) {
  return `${collection}:${id}`;
}

function toggleDetails(collection, id) {
  const key = detailKey(collection, id);
  expandedDetails[key] = !expandedDetails[key];
  render();
}

function isDetailsExpanded(collection, id) {
  return Boolean(expandedDetails[detailKey(collection, id)]);
}

function createLocationDraft(source) {
  return {
    draftId: createId("location"),
    source,
    name: "",
    type: source === "javascript" ? "js_condition" : "url",
    operator: source === "javascript" ? "equals" : "matches",
    value: "",
  };
}

function addNewLocation(source) {
  state.newLocations.push(createLocationDraft(source));
  render();
}

function updateNewLocation(draftId, field, value) {
  const draft = state.newLocations.find((item) => item.draftId === draftId);
  if (!draft) {
    return;
  }

  draft[field] = value;
  if (field === "source") {
    draft.type = value === "javascript" ? "js_condition" : "url";
    draft.operator = value === "javascript" ? "equals" : "matches";
    render();
    return;
  }

  if (field === "type") {
    render();
  }
}

function removeNewLocation(draftId) {
  state.newLocations = state.newLocations.filter((item) => item.draftId !== draftId);
  render();
}

function addNewGoal() {
  state.newGoals.push({
    draftId: createId("goal"),
    name: "",
    description: "",
  });
  render();
}

function updateNewGoal(draftId, field, value) {
  const draft = state.newGoals.find((item) => item.draftId === draftId);
  if (!draft) {
    return;
  }

  draft[field] = value;
}

function removeNewGoal(draftId) {
  state.newGoals = state.newGoals.filter((item) => item.draftId !== draftId);
  render();
}

function addVariationName() {
  state.variationNames.push(createVariationDraft(""));
  render();
}

function updateVariationName(draftId, value) {
  const draft = state.variationNames.find((item) => item.draftId === draftId);
  if (!draft) {
    return;
  }

  draft.name = value;
}

function removeVariationName(draftId) {
  const draftIndex = state.variationNames.findIndex((item) => item.draftId === draftId);
  if (draftIndex <= 0) {
    return;
  }

  state.variationNames = state.variationNames.filter((item) => item.draftId !== draftId);
  render();
}

function getTrimmedVariationNames() {
  return state.variationNames
    .map((item) => item.name.trim())
    .filter(Boolean);
}

function validateVariationNames() {
  const errors = [];
  const normalizedVariationNames = getTrimmedVariationNames();
  const seenVariationNames = new Set();

  state.variationNames.forEach((item, index) => {
    if (!item.name.trim()) {
      errors.push(
        index === 0
          ? "Variation 1 needs a name."
          : "Every added variation needs a name.",
      );
    }
  });

  normalizedVariationNames.forEach((name) => {
    const key = name.toLowerCase();
    if (key === "original") {
      errors.push("Do not add \"Original\" as a variation name; Convert creates it automatically.");
      return;
    }

    if (seenVariationNames.has(key)) {
      errors.push(`Variation name "${name}" is duplicated.`);
      return;
    }

    seenVariationNames.add(key);
  });

  return errors;
}

function getPlannedVariationNames() {
  return ["Original", ...getTrimmedVariationNames()];
}

function isAbsoluteUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateStep(step = currentStep) {
  const errors = [];

  if (!project.projectId) {
    errors.push("Project is required.");
  }

  if (step >= 0) {
    if (!state.name.trim()) {
      errors.push("Experiment name is required.");
    }
    const normalizedUrl = getNormalizedExperimentUrl();
    if (!normalizedUrl) {
      errors.push("Experiment URL is required.");
    } else if (!isAbsoluteUrl(normalizedUrl)) {
      errors.push("Experiment URL must be a valid absolute URL.");
    }
  }

  if (step >= 1) {
    if (!state.selectedLocations.length && !state.newLocations.length) {
      errors.push("Select or create at least one location.");
    }

    const invalidLocation = state.newLocations.find((location) =>
      !location.name.trim() || !location.value.trim(),
    );
    if (invalidLocation) {
      errors.push("Every new location needs a name and value.");
    }
  }

  if (step >= 2) {
    const invalidAudience = state.audiences.find((item) => !item.id);
    if (invalidAudience) {
      errors.push("Selected audiences must have valid IDs.");
    }
  }

  if (step >= 3) {
    const invalidGoal = state.goals.find((item) => !item.id);
    if (invalidGoal) {
      errors.push("Selected goals must have valid IDs.");
    }

    const invalidNewGoal = state.newGoals.find((goal) => !goal.name.trim());
    if (invalidNewGoal) {
      errors.push("Every new JS goal needs a name.");
    }
  }

  if (step >= 4) {
    errors.push(...validateVariationNames());
  }

  return errors;
}

function clearErrorsOnEdit() {
  const box = $("errorBox");
  if (!box.classList.contains("hidden")) {
    showErrors([]);
  }
}

function showErrors(errors) {
  const box = $("errorBox");
  if (!errors.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }

  box.classList.remove("hidden");
  box.innerHTML = `<strong>Check these details</strong><ul>${errors
    .map((error) => `<li>${escapeHtml(error)}</li>`)
    .join("")}</ul>`;
}

function nextStep() {
  if (isSuccessStep()) {
    post("closePanel");
    return;
  }

  const errors = validateStep(currentStep);
  if (errors.length) {
    showErrors(errors);
    return;
  }

  showErrors([]);
  if (currentStep === steps.length - 2) {
    submit();
    return;
  }

  currentStep += 1;
  render();
}

function backStep() {
  if (isSuccessStep()) {
    return;
  }

  if (currentStep > 0) {
    currentStep -= 1;
    showErrors([]);
    render();
  }
}

function buildSubmissionState() {
  return {
    name: state.name.trim(),
    url: getNormalizedExperimentUrl(),
    description: state.description.trim(),
    selectedLocations: state.selectedLocations.map((item) => ({
      id: item.id,
      name: item.name,
      visualEditorUrl: item.visualEditorUrl || "",
    })),
    newLocations: state.newLocations.map((item) => ({
      name: item.name.trim(),
      source: item.source,
      type: item.type,
      operator: item.operator,
      value: item.value.trim(),
    })),
    audiences: state.audiences.map((item) => ({
      id: item.id,
      name: item.name,
    })),
    goals: state.goals.map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
    })),
    newGoals: state.newGoals.map((item) => ({
      name: item.name.trim(),
      description: item.description.trim(),
    })),
    variationNames: state.variationNames
      .map((item) => item.name.trim())
      .filter(Boolean),
  };
}

function submit() {
  const errors = validateStep(steps.length - 2);
  if (errors.length) {
    showErrors(errors);
    return;
  }

  loading = true;
  render();
  post("createExperiment", { state: buildSubmissionState() });
}

function renderSteps() {
  $("steps").innerHTML = steps
    .map(
      (step, index) => `
        <button
          type="button"
          class="step ${index === currentStep ? "active" : ""} ${index < currentStep ? "done" : ""}"
          data-action="jump-step"
          data-index="${index}"
          ${index > currentStep || isSuccessStep() ? "disabled" : ""}
        >
          <span>${index + 1}</span>${escapeHtml(step)}
        </button>
      `,
    )
    .join("");
  $("stepCounter").textContent = `${currentStep + 1} of ${steps.length}`;
}

function jumpToStep(index) {
  if (!isSuccessStep() && index <= currentStep) {
    currentStep = index;
    showErrors([]);
    render();
  }
}

function renderSectionIntro(title, description) {
  return `
    <div class="content-intro">
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(description)}</p>
    </div>
  `;
}

function renderBasicInfo() {
  return `
    ${renderSectionIntro(
      "Basic info",
      "Set the experiment name, the page Convert should load, and any supporting hypothesis notes.",
    )}
    <div class="form-grid">
      <label>
        Experiment name
        <input
          data-field="name"
          value="${escapeHtml(state.name)}"
          placeholder="Homepage headline test"
        >
      </label>
      <label>
        Experiment URL
        <div class="url-field">
          <span class="url-prefix">https://</span>
          <input
            data-field="url"
            value="${escapeHtml(state.url)}"
            placeholder="example.com/pricing"
            spellcheck="false"
            autocomplete="off"
          >
        </div>
      </label>
      <label>
        Description or hypothesis
        <textarea
          data-field="description"
          rows="6"
          placeholder="Changing the primary CTA should improve signup intent."
        >${escapeHtml(state.description)}</textarea>
      </label>
    </div>
  `;
}

function renderSearchBar(kind, value, placeholder) {
  return `
    <div class="search-row">
      <input
        data-search-field="${kind}"
        value="${escapeHtml(value)}"
        placeholder="${escapeHtml(placeholder)}"
      >
      <button type="button" class="secondary small" data-action="search-assets" data-kind="${kind}">
        Search
      </button>
    </div>
  `;
}

function renderOptionDetails(item) {
  const detailLines = Array.isArray(item.details) ? item.details : [];
  const hasDescription = Boolean(item.description);

  if (!hasDescription && !detailLines.length) {
    return `<p class="option-detail-empty">No extra details available.</p>`;
  }

  return `
    ${hasDescription ? `<p class="option-detail-description">${escapeHtml(item.description)}</p>` : ""}
    ${detailLines.length
      ? `<dl class="option-detail-list">${detailLines
        .map((detail) => `
          <div>
            <dt>${escapeHtml(detail.label || "Detail")}</dt>
            <dd>${escapeHtml(detail.value || "")}</dd>
          </div>
        `)
        .join("")}</dl>`
      : ""}
  `;
}

function renderSelectableList(collection, items, emptyText) {
  if (!items.length) {
    return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  }

  const visibleItems = items.slice(0, 5);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  return `
    <div class="picker-list">
      ${visibleItems
        .map((item) => {
          const selected = state[collection].some(
            (entry) => String(entry.id) === String(item.id),
          );
          const expanded = isDetailsExpanded(collection, item.id);
          return `
            <div class="option-card ${selected ? "selected" : ""}">
              <div class="option-card-row">
                <label class="option-check">
                  <input
                    type="checkbox"
                    class="option-check-input"
                    ${selected ? "checked" : ""}
                    data-picker="${collection}"
                    data-id="${escapeHtml(item.id)}"
                  >
                  <span class="option-check-indicator" aria-hidden="true"></span>
                  <span class="option-check-copy">
                    <strong>${escapeHtml(item.name)}</strong>
                    <small>${escapeHtml(item.type || `ID ${item.id}`)}</small>
                  </span>
                </label>
                <button
                  type="button"
                  class="secondary small option-toggle"
                  data-action="toggle-option-details"
                  data-collection="${collection}"
                  data-id="${escapeHtml(item.id)}"
                >
                  ${expanded ? "Hide details" : "Details"}
                </button>
              </div>
              ${expanded ? `<div class="option-details">${renderOptionDetails(item)}</div>` : ""}
            </div>
          `;
        })
        .join("")}
      ${hiddenCount
        ? `<div class="picker-limit-note">Showing 5 results. Search or refine the filter to find ${hiddenCount} more.</div>`
        : ""}
    </div>
  `;
}

function renderSelectedChips(items, emptyText) {
  if (!items.length) {
    return `<div class="empty compact-empty">${escapeHtml(emptyText)}</div>`;
  }

  return `
    <div class="chip-list">
      ${items
        .map(
          (item) => `
            <span class="chip">
              ${escapeHtml(item.name)}
            </span>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderNewLocationForm(location) {
  const operators = location.source === "javascript"
    ? LOCATION_JS_OPERATORS
    : LOCATION_URL_OPERATORS;

  return `
    <div class="asset-card">
      <div class="asset-card-header">
        <strong>${escapeHtml(location.name || "New location")}</strong>
        <button type="button" class="icon-button" data-action="remove-new-location" data-id="${location.draftId}">
          Remove
        </button>
      </div>
      <div class="form-grid dense-grid">
        <label>
          Name
          <input
            data-new-location-id="${location.draftId}"
            data-new-location-field="name"
            value="${escapeHtml(location.name)}"
            placeholder="Homepage URL match"
          >
        </label>
        <label>
          Source
          <select data-new-location-id="${location.draftId}" data-new-location-field="source">
            <option value="url" ${location.source === "url" ? "selected" : ""}>URL</option>
            <option value="javascript" ${location.source === "javascript" ? "selected" : ""}>JavaScript</option>
          </select>
        </label>
        <label>
          Match option
          <select data-new-location-id="${location.draftId}" data-new-location-field="operator">
            ${operators
              .map(
                (operator) => `
                  <option value="${operator.value}" ${location.operator === operator.value ? "selected" : ""}>
                    ${escapeHtml(operator.label)}
                  </option>
                `,
              )
              .join("")}
          </select>
        </label>
        <label class="full-width">
          ${location.source === "javascript" ? "JavaScript expression" : "Value"}
          <textarea
            data-new-location-id="${location.draftId}"
            data-new-location-field="value"
            rows="${location.source === "javascript" ? "5" : "2"}"
            placeholder="${
              location.source === "javascript"
                ? "window.location.pathname === '/pricing'"
                : "https://example.com/pricing"
            }"
          >${escapeHtml(location.value)}</textarea>
        </label>
      </div>
    </div>
  `;
}

function renderLocations() {
  return `
    ${renderSectionIntro(
      "Location",
      "Pick from saved locations first, or add a simple URL or JavaScript location when you need a quick setup.",
    )}
    <div class="section-stack">
      <section class="content-section">
        <div class="section-heading">
          <div>
            <h3>Existing locations</h3>
            <p>Select from locations already saved in this project.</p>
          </div>
        </div>
        ${renderSearchBar("locations", locationSearch, "Search locations")}
        ${renderSelectableList("selectedLocations", availableLocations, "No locations found.")}
        ${renderSelectedChips(state.selectedLocations, "No existing locations selected.")}
      </section>

      <section class="content-section subsection">
        <div class="section-heading">
          <div>
            <h3>Create a simple location</h3>
            <p>Create a lightweight URL or JavaScript location without leaving this flow.</p>
          </div>
          <div class="inline-actions">
            <button type="button" class="secondary small" data-action="add-url-location">Add URL</button>
            <button type="button" class="secondary small" data-action="add-js-location">Add JS</button>
          </div>
        </div>
        ${
          state.newLocations.length
            ? `<div class="asset-stack">${state.newLocations.map(renderNewLocationForm).join("")}</div>`
            : `<div class="empty">No new locations added.</div>`
        }
      </section>
    </div>
  `;
}

function renderAudience() {
  return `
    ${renderSectionIntro(
      "Audience",
      "Choose from audiences that already exist in this project.",
    )}
    <div class="section-stack">
      <section class="content-section">
        <div class="section-heading">
          <div>
            <h3>Existing audiences</h3>
            <p>Search and select the audiences you want to attach to this experiment.</p>
          </div>
        </div>
        ${renderSearchBar("audiences", audienceSearch, "Search audiences")}
        ${renderSelectableList("audiences", availableAudiences, "No audiences found.")}
        ${renderSelectedChips(state.audiences, "No audiences selected.")}
      </section>
    </div>
  `;
}

function renderNewGoalForm(goal) {
  return `
    <div class="asset-card">
      <div class="asset-card-header">
        <strong>${escapeHtml(goal.name || "New JS goal")}</strong>
        <button type="button" class="icon-button" data-action="remove-new-goal" data-id="${goal.draftId}">
          Remove
        </button>
      </div>
      <div class="form-grid dense-grid">
        <label>
          Name
          <input
            data-new-goal-id="${goal.draftId}"
            data-new-goal-field="name"
            value="${escapeHtml(goal.name)}"
            placeholder="Trigger checkout success"
          >
        </label>
        <label class="full-width">
          Description
          <textarea
            data-new-goal-id="${goal.draftId}"
            data-new-goal-field="description"
            rows="3"
            placeholder="Creates a code trigger goal in Convert."
          >${escapeHtml(goal.description)}</textarea>
        </label>
      </div>
    </div>
  `;
}

function renderGoals() {
  return `
    ${renderSectionIntro(
      "Goals",
      "Select existing goals or add a simple JavaScript goal. The first selected goal becomes the primary goal.",
    )}
    <div class="section-stack">
      <section class="content-section">
        <div class="section-heading">
          <div>
            <h3>Existing goals</h3>
            <p>Search and select goals already available in the project.</p>
          </div>
        </div>
        ${renderSearchBar("goals", goalSearch, "Search goals")}
        ${renderSelectableList("goals", availableGoals, "No goals found.")}
        ${renderSelectedChips(state.goals, "No existing goals selected.")}
      </section>

      <section class="content-section subsection">
        <div class="section-heading">
          <div>
            <h3>Create a JS goal</h3>
            <p>Create a simple <code>code_trigger</code> goal and attach it automatically.</p>
          </div>
          <button type="button" class="secondary small" data-action="add-new-goal">Add JS goal</button>
        </div>
        ${
          state.newGoals.length
            ? `<div class="asset-stack">${state.newGoals.map(renderNewGoalForm).join("")}</div>`
            : `<div class="empty">No new JS goals added.</div>`
        }
      </section>
    </div>
  `;
}

function renderVariationNameForm(variation, index) {
  const isPrimaryVariation = index === 0;
  const variationLabel = `Variation ${index + 1}`;
  return `
    <div class="asset-card">
      <div class="asset-card-header">
        <strong>${escapeHtml(variationLabel)}</strong>
        ${isPrimaryVariation
          ? `<span class="option-detail-empty">Required</span>`
          : `<button type="button" class="icon-button" data-action="remove-new-variation" data-id="${variation.draftId}">
              Remove
            </button>`}
      </div>
      <div class="form-grid dense-grid">
        <label>
          Variation name
          <input
            data-new-variation-id="${variation.draftId}"
            data-new-variation-field="name"
            value="${escapeHtml(variation.name)}"
            placeholder="${escapeHtml(variationLabel)}"
          >
        </label>
      </div>
    </div>
  `;
}

function renderVariations() {
  const plannedNames = getPlannedVariationNames();
  return `
    ${renderSectionIntro(
      "Variations",
      "Original is always created automatically. Rename Variation 1 here, then add any extra variations you want after it.",
    )}
    <div class="section-stack">
      <section class="content-section">
        <div class="section-heading">
          <div>
            <h3>Variation lineup</h3>
            <p>Variation 1 is included by default. Add more rows to create Variation 2, Variation 3, and beyond.</p>
          </div>
          <button type="button" class="secondary small" data-action="add-new-variation">Add variation</button>
        </div>
        <div class="asset-stack">${state.variationNames.map(renderVariationNameForm).join("")}</div>
      </section>

      <section class="content-section subsection">
        <div class="section-heading">
          <div>
            <h3>Experiment will create</h3>
            <p>Traffic is split evenly across the final list during creation.</p>
          </div>
        </div>
        ${renderSelectedChips(
          plannedNames.map((name) => ({ name })),
          "No variations planned.",
        )}
      </section>
    </div>
  `;
}

function renderReviewRow(label, value) {
  return `
    <div>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(value || "None")}</span>
    </div>
  `;
}

function renderReview() {
  return `
    ${renderSectionIntro(
      "Review",
      "Take a last pass through the setup before creating the experiment in Convert.",
    )}
    <div class="review-grid">
      ${renderReviewRow("Name", state.name)}
      ${renderReviewRow("Project", project.projectName || project.projectId)}
      ${renderReviewRow("Experiment URL", getNormalizedExperimentUrl())}
      ${renderReviewRow("Description", state.description || "None")}
      ${renderReviewRow(
        "Locations",
        [
          ...state.selectedLocations.map((item) => item.name),
          ...state.newLocations.map((item) => `${item.name} (${item.source})`),
        ].join(", "),
      )}
      ${renderReviewRow(
        "Audiences",
        state.audiences.map((item) => item.name).join(", "),
      )}
      ${renderReviewRow(
        "Goals",
        [
          ...state.goals.map((item) => item.name),
          ...state.newGoals.map((item) => `${item.name} (code_trigger)`),
        ].join(", "),
      )}
      ${renderReviewRow(
        "Variations",
        getPlannedVariationNames().join(", "),
      )}
    </div>
  `;
}

function renderSuccess() {
  const experiment = successExperiment || {};
  return `
    <div class="success-state">
      ${renderSectionIntro(
        "Creation successful",
        "Your experiment is ready in Convert and the sidebar has already been updated for the next upload step.",
      )}
      <div class="success-card">
        <div class="success-badge">Created</div>
        <h2>${escapeHtml(experiment.name || state.name)}</h2>
        <p>Experiment ID: ${escapeHtml(experiment.id || "Unavailable")}</p>
      </div>
      <div class="review-grid success-grid">
        ${renderReviewRow("Project", project.projectName || project.projectId)}
        ${renderReviewRow("Experiment URL", experiment.url || getNormalizedExperimentUrl())}
        ${renderReviewRow("Summary link", experiment.summaryLink || "Unavailable")}
      </div>
      <div class="inline-actions success-actions">
        ${experiment.summaryLink
          ? `<button type="button" data-action="open-link" data-href="${escapeHtml(experiment.summaryLink)}">Open in Convert</button>`
          : ""}
      </div>
    </div>
  `;
}

function renderContent() {
  const renderers = [
    renderBasicInfo,
    renderLocations,
    renderAudience,
    renderGoals,
    renderVariations,
    renderReview,
    renderSuccess,
  ];
  $("content").innerHTML = renderers[currentStep]();
}

function render() {
  const scrollY = window.scrollY;
  const focusSnapshot = getFocusableSnapshot();

  $("projectLabel").textContent = project.projectName
    ? `${project.projectName} (${project.projectId})`
    : project.projectId
      ? `Project ${project.projectId}`
      : "No project selected";

  renderSteps();
  renderContent();
  $("backBtn").disabled = loading || currentStep === 0 || isSuccessStep();
  $("backBtn").classList.toggle("hidden", isSuccessStep());
  $("nextBtn").disabled = loading;
  $("nextBtn").textContent = loading
    ? "Creating experiment..."
    : isSuccessStep()
      ? "Close"
      : currentStep === steps.length - 2
        ? "Create experiment"
        : "Next";
  $("nextBtn").classList.toggle("success-action", currentStep === steps.length - 2 || isSuccessStep());

  restoreFocusableSnapshot(focusSnapshot);
  window.scrollTo({ top: scrollY });
}

window.addEventListener("message", ({ data }) => {
  switch (data.command) {
    case "initialize":
      project = data.data || project;
      currentStep = 0;
      loading = false;
      successExperiment = null;
      locationSearch = "";
      audienceSearch = "";
      goalSearch = "";
      expandedDetails = {};
      state = createInitialState();
      post("requestLocations");
      post("requestAudiences");
      post("requestGoals");
      showErrors([]);
      render();
      break;
    case "locations":
      availableLocations = data.data || [];
      render();
      break;
    case "audiences":
      availableAudiences = data.data || [];
      render();
      break;
    case "goals":
      availableGoals = data.data || [];
      render();
      break;
    case "createExperimentFailed":
      loading = false;
      showErrors(data.errors?.length ? data.errors : [data.message || "Create failed."]);
      render();
      break;
    case "createExperimentSucceeded":
      loading = false;
      successExperiment = data.experiment || null;
      currentStep = steps.length - 1;
      showErrors([]);
      render();
      break;
  }
});

function handleContentInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    const field = target.dataset.field;
    if (field) {
      updateField(field, target.value);
      clearErrorsOnEdit();
      return;
    }

    const searchField = target.dataset.searchField;
    if (searchField) {
      setSearch(searchField, target.value);
      return;
    }

    const newLocationId = target.dataset.newLocationId;
    const newLocationField = target.dataset.newLocationField;
    if (newLocationId && newLocationField) {
      updateNewLocation(newLocationId, newLocationField, target.value);
      clearErrorsOnEdit();
      return;
    }

    const newGoalId = target.dataset.newGoalId;
    const newGoalField = target.dataset.newGoalField;
    if (newGoalId && newGoalField) {
      updateNewGoal(newGoalId, newGoalField, target.value);
      clearErrorsOnEdit();
      return;
    }

    const newVariationId = target.dataset.newVariationId;
    const newVariationField = target.dataset.newVariationField;
    if (newVariationId && newVariationField === "name") {
      updateVariationName(newVariationId, target.value);
      clearErrorsOnEdit();
    }
  }
}

function handleContentChange(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target instanceof HTMLSelectElement) {
    const newLocationId = target.dataset.newLocationId;
    const newLocationField = target.dataset.newLocationField;
    if (newLocationId && newLocationField) {
      updateNewLocation(newLocationId, newLocationField, target.value);
      clearErrorsOnEdit();
      return;
    }
  }

  if (target instanceof HTMLInputElement && target.type === "checkbox") {
    const picker = target.dataset.picker;
    const id = target.dataset.id;
    const source = picker === "selectedLocations"
      ? availableLocations
      : picker === "audiences"
        ? availableAudiences
        : availableGoals;
    const item = source.find((entry) => String(entry.id) === String(id));
    if ((picker === "selectedLocations" || picker === "audiences" || picker === "goals") && item) {
      toggleSelectedItem(picker, item);
      clearErrorsOnEdit();
    }
  }
}

function handleSearchKeydown(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  const searchField = target.dataset.searchField;
  if (searchField && event.key === "Enter") {
    event.preventDefault();
    requestSearch(searchField);
  }
}

function handleDocumentClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const actionElement = target.closest("[data-action]");
  if (!(actionElement instanceof HTMLElement)) {
    return;
  }

  const index = Number(actionElement.dataset.index);
  const id = actionElement.dataset.id || "";
  switch (actionElement.dataset.action) {
    case "jump-step":
      jumpToStep(index);
      break;
    case "search-assets":
      requestSearch(actionElement.dataset.kind || "");
      break;
    case "toggle-option-details":
      toggleDetails(actionElement.dataset.collection || "", id);
      break;
    case "add-url-location":
      addNewLocation("url");
      break;
    case "add-js-location":
      addNewLocation("javascript");
      break;
    case "remove-new-location":
      removeNewLocation(id);
      break;
    case "add-new-goal":
      addNewGoal();
      break;
    case "remove-new-goal":
      removeNewGoal(id);
      break;
    case "add-new-variation":
      addVariationName();
      break;
    case "remove-new-variation":
      removeVariationName(id);
      break;
    case "open-link":
      post("openExternal", { href: actionElement.dataset.href || "" });
      break;
  }
}

$("backBtn").addEventListener("click", backStep);
$("nextBtn").addEventListener("click", nextStep);
$("content").addEventListener("input", handleContentInput);
$("content").addEventListener("change", handleContentChange);
$("content").addEventListener("keydown", handleSearchKeydown);
$("steps").addEventListener("click", handleDocumentClick);
$("content").addEventListener("click", handleDocumentClick);

post("ready");
render();
