import * as vscode from "vscode";
import * as crypto from "crypto";

const REDIRECT_URI =
  "https://shreyashsingh101.github.io/convert-vscode-extension/callback";
const AUTH_URL = "https://app.convert.com/auth/oauth/authorize";
const TOKEN_URL = "https://api.convert.com/api/v2/auth/oauth/token";
const SECRET_TOKEN_STORAGE_KEY = "convert.accessToken";
const SECRET_ACCOUNTS_STORAGE_KEY = "convert.accounts";
const SECRET_CLIENT_ID_STORAGE_KEY = "convert.clientId";

export interface ConvertAccount {
  account_id: number | string;
  name: string;
  projects?: unknown[];
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_at: number;
  scope: {
    mode: string;
    accounts: ConvertAccount[];
  };
}

function generateVerifier(): string {
  return crypto
    .randomBytes(64)
    .toString("base64url")
    .replace(/[^a-zA-Z0-9\-._~]/g, "")
    .substring(0, 64);
}

function generateChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export async function storeToken(
  context: vscode.ExtensionContext,
  token: string,
) {
  await context.secrets.store(SECRET_TOKEN_STORAGE_KEY, token);
}

export async function getToken(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  return context.secrets.get(SECRET_TOKEN_STORAGE_KEY);
}

export async function storeClientId(
  context: vscode.ExtensionContext,
  clientId: string,
) {
  const trimmed = clientId.trim();

  if (trimmed) {
    await context.secrets.store(SECRET_CLIENT_ID_STORAGE_KEY, trimmed);
  } else {
    await context.secrets.delete(SECRET_CLIENT_ID_STORAGE_KEY);
  }
}

export async function getClientId(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  return context.secrets.get(SECRET_CLIENT_ID_STORAGE_KEY);
}

export async function getStoredAccounts(
  context: vscode.ExtensionContext,
): Promise<ConvertAccount[]> {
  const raw = await context.secrets.get(SECRET_ACCOUNTS_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as ConvertAccount[]) : [];
}

export async function clearToken(context: vscode.ExtensionContext) {
  await context.secrets.delete(SECRET_TOKEN_STORAGE_KEY);
  await context.secrets.delete(SECRET_ACCOUNTS_STORAGE_KEY);
}

export async function clearClientId(context: vscode.ExtensionContext) {
  await context.secrets.delete(SECRET_CLIENT_ID_STORAGE_KEY);
}

export async function authenticate(
  context: vscode.ExtensionContext,
): Promise<TokenResponse> {
  const clientId = await getClientId(context);

  if (!clientId) {
    throw new Error("Add client ID first");
  }

  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);

  const scheme = vscode.env.uriScheme;
  const rawState = crypto.randomBytes(16).toString("hex");
  const state = `${scheme}|${rawState}`;

  const authUri = vscode.Uri.parse(
    `${AUTH_URL}?client_id=${encodeURIComponent(clientId)}` +
      `&response_type=code` +
      `&scope=selected_accounts_projects` +
      `&state=${encodeURIComponent(state)}` +
      `&code_challenge=${challenge}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
  );

  const token = await new Promise<TokenResponse>((resolve, reject) => {
    const disposable = vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri): void {
        disposable.dispose();

        const params = new URLSearchParams(uri.query);
        const code = params.get("code");
        const returnedState = params.get("state");

        if (!code) {
          reject(new Error("No authorization code received"));
          return;
        }

        if (returnedState !== rawState) {
          reject(new Error("State mismatch - possible CSRF attack"));
          return;
        }

        exchangeCodeForToken(code, verifier, clientId)
          .then(resolve)
          .catch(reject);
      },
    });

    vscode.env.openExternal(authUri);

    setTimeout(() => {
      disposable.dispose();
      reject(new Error("Authentication timed out"));
    }, 5 * 60 * 1000);
  });

  await storeToken(context, token.access_token);
  await context.secrets.store(
    SECRET_ACCOUNTS_STORAGE_KEY,
    JSON.stringify(token.scope?.accounts ?? []),
  );

  return token;
}

async function exchangeCodeForToken(
  code: string,
  verifier: string,
  clientId: string,
): Promise<TokenResponse> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Token exchange failed: ${err}`);
  }

  const data = (await response.json()) as TokenResponse;
  if (!data.access_token) {
    throw new Error("No access_token in response");
  }

  return data;
}
