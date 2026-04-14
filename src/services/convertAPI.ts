const BASE_URL = "https://api.convert.com/api/v2";

async function request(
  url: string,
  apiKey: string,
  method: string = "POST",
  body?: object,
) {
  console.log(`🌐 ${method} ${url}`);

  if (body) {
    console.log("📦 Request Body:", JSON.stringify(body, null, 2));
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();

  console.log("📥 Raw Response:", text);

  if (!res.ok) {
    console.error("❌ API Error:", res.status, text);
    throw new Error(`API error ${res.status}: ${text}`);
  }

  try {
    const json = JSON.parse(text);
    console.log("✅ Parsed Response:", json);
    return json;
  } catch {
    console.warn("⚠️ Non-JSON response");
    return text;
  }
}

export const convertApi = {
  getProjects: (apiKey: string, accountId: string) =>
    request(`${BASE_URL}/accounts/${accountId}/projects`, apiKey, "POST"),

  getExperiences: (apiKey: string, accountId: string, projectId: string) =>
    request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/experiences`,
      apiKey,
      "POST",
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

  // Ready to wire up when the Convert API endpoint is confirmed
  updateVariation: async (
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

    console.log("📤 Sending payload:", JSON.stringify(body, null, 2));

    const res = await request(
      `${BASE_URL}/accounts/${accountId}/projects/${projectId}/experiences/${experienceId}/variations/${variationId}/update`,
      apiKey,
      "PUT",
      body,
    );

    console.log("✅ API Response:", res);

    return res;
  },
};
