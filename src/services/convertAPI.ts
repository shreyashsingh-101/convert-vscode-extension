const BASE_URL = "https://api.convert.com/api/v2";

async function request(
  url: string,
  apiKey: string,
  method: string = "POST",
  body?: object,
) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
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

export const convertApi = {
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
};
