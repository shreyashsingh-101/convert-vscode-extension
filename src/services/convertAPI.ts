const BASE_URL = "https://api.convert.com/api/v2";

async function request(
  url: string,
  apiKey: string,
  method: string = "POST",
  body?: object,
) {
  const normalizedMethod = method.toUpperCase();
  const requestBody = normalizedMethod === "GET" || normalizedMethod === "HEAD"
    ? undefined
    : body ? JSON.stringify(body) : undefined;

  const res = await fetch(url, {
    method: normalizedMethod,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: requestBody,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestMultipart(url: string, apiKey: string, body: FormData) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export interface CreateExperimentPayload {
  name: string;
  description?: string;
  objective?: string;
  type: string;
  status: string;
  url: string;
  audiences?: number[];
  goals?: number[];
  locations?: number[];
  primary_goal?: number;
  variations?: Array<{
    name: string;
    is_baseline?: boolean;
    traffic_distribution?: number;
  }>;
  settings?: {
    matching_options?: {
      audiences?: "any" | "all";
      locations?: "any" | "all";
    };
  };
}

export interface CreateLocationPayload {
  name: string;
  description?: string;
  status?: "active" | "archived";
  selected_default?: boolean;
  rules: {
    OR: Array<{
      AND: Array<{
        OR_WHEN: Array<{
          rule_type: string;
          value: string;
          matching: {
            match_type: string;
            negated: boolean;
          };
        }>;
      }>;
    }>;
  };
  trigger?: {
    type: "upon_run" | "manual" | "dom_element" | "callback";
  };
}

export interface CreateGoalPayload {
  name: string;
  type: "code_trigger";
  key?: string;
  description?: string;
  status?: "active" | "archived";
  selected_default?: boolean;
}

export const convertApi = {
  requestEndpoint: (
    apiKey: string,
    path: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    body?: object,
  ) =>
    request(
      `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`,
      apiKey,
      method,
      body,
    ),

  getProject: (apiKey: string, accountId: string, projectId: string) =>
    request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}`,
      apiKey,
      "GET",
    ),

  getProjects: (apiKey: string, accountId: string, search?: string) =>
    request(`${BASE_URL}/accounts/${accountId}/projects`, apiKey, "POST", {
      search: search || "",
    }),

  getExperiences: (
    apiKey: string,
    accountId: string,
    projectId: string,
    search?: string,
  ) =>
    request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/experiences`,
      apiKey,
      "POST",
      { search: search || "" },
    ),

  getAudiences: (
    apiKey: string,
    accountId: string,
    projectId: string,
    search?: string,
  ) =>
    request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/audiences`,
      apiKey,
      "POST",
      {
        search: search || "",
        status: ["active"],
        results_per_page: 50,
        include: ["rules"],
      },
    ),

  getGoals: (
    apiKey: string,
    accountId: string,
    projectId: string,
    search?: string,
  ) =>
    request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/goals`,
      apiKey,
      "POST",
      {
        search: search || "",
        status: ["active"],
        results_per_page: 50,
        include: ["triggering_rule"],
      },
    ),

  createGoal: (
    apiKey: string,
    accountId: string,
    projectId: string,
    payload: CreateGoalPayload,
  ) =>
    request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/goals/add`,
      apiKey,
      "POST",
      payload,
    ),

  getLocations: (
    apiKey: string,
    accountId: string,
    projectId: string,
    search?: string,
  ) =>
    request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/locations`,
      apiKey,
      "POST",
      {
        search: search || "",
        status: ["active"],
        results_per_page: 50,
        include: ["rules", "trigger"],
      },
    ),

  createLocation: (
    apiKey: string,
    accountId: string,
    projectId: string,
    payload: CreateLocationPayload,
  ) =>
    request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/locations/add`,
      apiKey,
      "POST",
      payload,
    ),

  createExperiment: (
    apiKey: string,
    accountId: string,
    projectId: string,
    payload: CreateExperimentPayload,
  ) =>
    request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/experiences/add?expand[]=variations&expand[]=audiences&expand[]=goals&expand[]=locations`,
      apiKey,
      "POST",
      payload,
    ),

  getVariations: (
    apiKey: string,
    accountId: string,
    projectId: string,
    experienceId: string,
  ) =>
    request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/experiences/${experienceId}?expand[]=variations`,
      apiKey,
      "GET",
    ),

  getExperienceDetails: (
    apiKey: string,
    accountId: string,
    projectId: string,
    experienceId: string,
  ) =>
    request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/experiences/${experienceId}`,
      apiKey,
      "GET",
    ),

  getVariationDetails: (
    apiKey: string,
    accountId: string,
    projectId: string,
    experienceId: string,
    _variationId: string,
  ) =>
    request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/experiences/${experienceId}?expand[]=variations.changes`,
      apiKey,
      "GET",
    ),

  updateExperience: (
    apiKey: string,
    accountId: string,
    projectId: string,
    experienceId: string,
    payload: { global_js?: string; global_css?: string },
  ) =>
    request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/experiences/${experienceId}/update`,
      apiKey,
      "POST",
      payload,
    ),

  updateVariation: (
    apiKey: string,
    accountId: string,
    projectId: string,
    experienceId: string,
    variationId: string,
    payload: { js?: string; css?: string },
  ) => {
    const body = {
      changes: [
        {
          type: "customCode",
          data: {
            js: payload.js || "",
            css: payload.css || "",
          },
        },
      ],
    };

    return request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/experiences/${experienceId}/variations/${variationId}/update`,
      apiKey,
      "PUT",
      body,
    );
  },

  uploadImage: (
    apiKey: string,
    accountId: string,
    projectId: string,
    imageName: string,
    image: Uint8Array,
  ) => {
    const body = new FormData();

    body.append("image_name", imageName);
    body.append("image", new Blob([image]), imageName);

    return requestMultipart(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/images/add`,
      apiKey,
      body,
    );
  },
};
