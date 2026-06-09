export interface ConvertApiDocEntry {
  id: string;
  group: string;
  name: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  summary: string;
  notes?: string[];
  url: string;
}

const DOCS_ROOT = "https://api.convert.com/doc/v2/";

const docEntries: ConvertApiDocEntry[] = [
  {
    id: "projects-list",
    group: "projects",
    name: "List projects",
    method: "POST",
    path: "/accounts/{account_id}/projects",
    summary: "Lists projects for an account. Supports filters like search and pagination.",
    notes: ["Used by the extension project picker."],
    url: DOCS_ROOT,
  },
  {
    id: "projects-get",
    group: "projects",
    name: "Get project details",
    method: "GET",
    path: "/accounts/{account_id}/projects/{project_id}",
    summary: "Returns details for a specific project.",
    url: DOCS_ROOT,
  },
  {
    id: "experiences-list",
    group: "experiences",
    name: "List experiments",
    method: "POST",
    path: "/accounts/{account_id}/projects/{project_id}/experiences",
    summary: "Lists experiments within a project. Supports search and expansion fields.",
    notes: ["Convert docs use the term experiences for experiments."],
    url: DOCS_ROOT,
  },
  {
    id: "experiences-get",
    group: "experiences",
    name: "Get experiment details",
    method: "GET",
    path: "/accounts/{account_id}/projects/{project_id}/experiences/{experience_id}",
    summary: "Returns a single experiment. Can expand variations, audiences, goals, and locations.",
    url: DOCS_ROOT,
  },
  {
    id: "experiences-create",
    group: "experiences",
    name: "Create experiment",
    method: "POST",
    path: "/accounts/{account_id}/projects/{project_id}/experiences/add",
    summary: "Creates a new experiment or experience within a project.",
    notes: [
      "The extension wizard defaults to type a/b and status draft.",
      "Use the MCP create_experiment tool with variationNames to create named non-baseline variations during experiment creation.",
    ],
    url: DOCS_ROOT,
  },
  {
    id: "experiences-update",
    group: "experiences",
    name: "Update experiment",
    method: "POST",
    path: "/accounts/{account_id}/projects/{project_id}/experiences/{experience_id}/update",
    summary: "Updates experiment fields such as global code and configuration.",
    url: DOCS_ROOT,
  },
  {
    id: "variations-update",
    group: "variations",
    name: "Update variation",
    method: "PUT",
    path: "/accounts/{account_id}/projects/{project_id}/experiences/{experience_id}/variations/{variation_id}/update",
    summary: "Updates a variation. The extension uses this for JS and CSS pushes.",
    notes: [
      "Variation code is sent as a customCode change payload.",
      "If there is no dedicated MCP wrapper for a documented variation operation, use search_convert_api_docs first and then call_convert_api with the account-scoped path.",
    ],
    url: DOCS_ROOT,
  },
  {
    id: "locations-list",
    group: "locations",
    name: "List locations",
    method: "POST",
    path: "/accounts/{account_id}/projects/{project_id}/locations",
    summary: "Lists project locations. Supports search, status, pagination, and include fields.",
    url: DOCS_ROOT,
  },
  {
    id: "locations-create",
    group: "locations",
    name: "Create location",
    method: "POST",
    path: "/accounts/{account_id}/projects/{project_id}/locations/add",
    summary: "Creates a location with rules and an optional trigger.",
    notes: ["The extension currently supports simple URL or JS condition creation."],
    url: DOCS_ROOT,
  },
  {
    id: "audiences-list",
    group: "audiences",
    name: "List audiences",
    method: "POST",
    path: "/accounts/{account_id}/projects/{project_id}/audiences",
    summary: "Lists project audiences. Supports search, type, usage, and include fields.",
    url: DOCS_ROOT,
  },
  {
    id: "audiences-create",
    group: "audiences",
    name: "Create audience",
    method: "POST",
    path: "/accounts/{account_id}/projects/{project_id}/audiences/add",
    summary: "Creates a new audience in the project.",
    url: DOCS_ROOT,
  },
  {
    id: "goals-list",
    group: "goals",
    name: "List goals",
    method: "POST",
    path: "/accounts/{account_id}/projects/{project_id}/goals",
    summary: "Lists project goals. Supports search, tracked status, usage, goal type, and include fields.",
    url: DOCS_ROOT,
  },
  {
    id: "goals-create",
    group: "goals",
    name: "Create goal",
    method: "POST",
    path: "/accounts/{account_id}/projects/{project_id}/goals/add",
    summary: "Creates a new goal in the project.",
    notes: ["The extension currently creates JS goals as code_trigger goals."],
    url: DOCS_ROOT,
  },
  {
    id: "images-create",
    group: "images",
    name: "Upload image",
    method: "POST",
    path: "/accounts/{account_id}/projects/{project_id}/images/add",
    summary: "Uploads an image asset into the project CDN.",
    notes: ["This is a multipart upload endpoint."],
    url: DOCS_ROOT,
  },
];

export function getConvertApiDocsOverview() {
  const groups = [...new Set(docEntries.map((entry) => entry.group))];
  return {
    docsRoot: DOCS_ROOT,
    usageGuidance: [
      "Prefer dedicated MCP tools when available.",
      "If a method is not exposed as a dedicated MCP tool, use search_convert_api_docs to find the endpoint and then call_convert_api to execute the account-scoped request.",
      "The generic call_convert_api tool accepts either body or payload for request data.",
      "For new experiments with multiple named variations, use create_experiment with variationNames instead of creating the experiment first and renaming Variation 1 later.",
    ],
    groups,
    entries: docEntries,
  };
}

export function searchConvertApiDocs(query: string) {
  const normalized = query.trim().toLowerCase();
  const tokens = normalized.split(/\s+/).filter(Boolean);

  const results = !tokens.length
    ? docEntries
    : docEntries.filter((entry) => {
      const haystack = [
        entry.group,
        entry.name,
        entry.method,
        entry.path,
        entry.summary,
        ...(entry.notes ?? []),
      ]
        .join(" ")
        .toLowerCase();

      return tokens.every((token) => haystack.includes(token));
    });

  return {
    docsRoot: DOCS_ROOT,
    query,
    results,
  };
}

export function getConvertApiDocsResource() {
  const lines = [
    "# Convert API v2 quick reference",
    "",
    `Official docs root: ${DOCS_ROOT}`,
    "",
    "## How to use this from MCP clients",
    "- Prefer dedicated MCP tools when available.",
    "- If a documented Convert method does not have a dedicated MCP wrapper yet, call `search_convert_api_docs` first, then use `call_convert_api` with the account-scoped path.",
    "- `call_convert_api` accepts either `body` or `payload` for request data.",
    "- For new experiments with named extra variations, use `create_experiment` with `variationNames` rather than renaming the default second variation afterward.",
    "",
  ];

  for (const entry of docEntries) {
    lines.push(`## ${entry.name}`);
    lines.push(`- Group: ${entry.group}`);
    lines.push(`- Method: ${entry.method}`);
    lines.push(`- Path: \`${entry.path}\``);
    lines.push(`- Summary: ${entry.summary}`);
    if (entry.notes?.length) {
      lines.push(`- Notes: ${entry.notes.join(" ")}`);
    }
    lines.push(`- Docs: ${entry.url}`);
    lines.push("");
  }

  return lines.join("\n");
}
