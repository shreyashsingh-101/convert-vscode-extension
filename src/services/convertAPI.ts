const BASE_URL = "https://api.convert.com/api/v2";

async function request(url: string, apiKey: string, method?: string) {
    console.log("REQUESTING:", url, "WITH API KEY:", apiKey);
  const res = await fetch(url, {
    method: method || "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text);
  }

  console.log("RESPONSE:", res);

  return res.json();
}

export const convertApi = {
  getProjects: (apiKey: string, accountId: string) =>
    request(`${BASE_URL}/accounts/${accountId}/projects`, apiKey),

  getExperiences: (apiKey: string, accountId: string, projectId: string) =>
    request(`${BASE_URL}/accounts/${accountId}/projects/${projectId}/experiences`, apiKey),

  getVariations: (apiKey: string, accountId: string, projectId: string, experienceId: string) =>
    request(`${BASE_URL}/accounts/${accountId}/projects/${projectId}/experiences/${experienceId}?expand[]=variations`, apiKey, "GET"),
};