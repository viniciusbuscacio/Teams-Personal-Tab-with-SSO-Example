import type { ProtectedResult } from "../shared/sso-config";

const messages = {
  AUTH_REQUIRED: "Sign in with Microsoft to continue.",
  AUTH_ORIGIN: "Open the app at its configured HTTPS address.",
  AUTH_TOKEN_UNAVAILABLE: "Unable to obtain a Microsoft access token. Sign in again.",
  AUTH_TEAMS_TOKEN: "Teams did not provide an SSO token. Try signing in. If the issue persists, check permissions and configuration.",
  AUTH_TEAMS_INIT: "Unable to initialize the tab in Teams. Reopen the app in Teams.",
  AUTH_TEAMS_TIMEOUT: "Teams did not respond within 8 seconds during initialization. Reopen the app.",
  AUTH_INTERACTION: "Consent, multifactor authentication, or another sign-in is required. Select Sign in with Microsoft. If the issue persists, contact your administrator.",
  AUTH_POPUP: "Sign-in was not completed. Allow the Microsoft pop-up, complete authentication, and try again.",
  AUTH_STORAGE: "Session storage is unavailable. Allow it to stay signed out of the app after reloading.",
  AUTH_CLEAR: "Unable to clear the local cache. Close this tab before signing in again.",
  AUTH_BACKEND_401: "The API rejected the token after a second attempt. Check the tenant, audience, and scope.",
} as const;
export class AuthFailure extends Error {
  constructor(public readonly code: keyof typeof messages = "AUTH_REQUIRED") {
    super(`${messages[code]} [${code}]`);
  }
}
export type TokenSource = {
  token: (refresh: boolean) => Promise<string>;
  signIn: () => Promise<string>;
  clear: () => Promise<void>;
};
export async function loadProfile(source: TokenSource, signal?: AbortSignal, initialToken?: string): Promise<ProtectedResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let token: string;
    signal?.throwIfAborted();
    try { token = attempt === 0 && initialToken ? initialToken : await source.token(attempt === 1); }
    catch (error) { throw error instanceof AuthFailure ? error : new AuthFailure("AUTH_TOKEN_UNAVAILABLE"); }
    if (!token) throw new AuthFailure("AUTH_TOKEN_UNAVAILABLE");
    signal?.throwIfAborted();
    const response = await fetch("/api/me", {
      credentials: "omit", redirect: "error", cache: "no-store", signal,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      if (!attempt) continue;
      throw new AuthFailure("AUTH_BACKEND_401");
    }
    if (!response.ok) throw new Error(`The API is unavailable (HTTP ${response.status}). Try again later.`);
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("message" in data) || typeof data.message !== "string" ||
        !("user" in data) || !data.user || typeof data.user !== "object" || Array.isArray(data.user))
      throw new Error("Unexpected API response.");
    const user = data.user;
    if (("name" in user && typeof user.name !== "string") ||
        ("username" in user && typeof user.username !== "string")) throw new Error("Unexpected profile returned by the API.");
    return { message: data.message, user };
  }
  throw new AuthFailure();
}
