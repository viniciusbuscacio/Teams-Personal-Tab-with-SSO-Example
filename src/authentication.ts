import { PublicClientApplication, BrowserCacheLocation, InteractionRequiredAuthError, type Configuration } from "@azure/msal-browser";
import { parseSsoConfig, type SsoConfig } from "../shared/sso-config";
import { AuthFailure, type TokenSource } from "./auth-client";

export function msalConfiguration(config: SsoConfig): Configuration {
  return {
    auth: { clientId: config.clientId, authority: config.authority, redirectUri: config.redirectUri },
    cache: { cacheLocation: BrowserCacheLocation.MemoryStorage },
    system: { allowRedirectInIframe: false, allowPlatformBroker: false, serverTelemetryEnabled: false,
      iframeBridgeTimeout: 8000,
      loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } },
  };
}
export async function prepareAuthentication(embedded: boolean): Promise<TokenSource> {
  const response = await fetch("/api/auth-config", { credentials: "omit", redirect: "error" });
  if (!response.ok) throw new Error("SSO is not configured. Check the server configuration.");
  const config = parseSsoConfig(await response.json());
  if (config.origin !== window.location.origin) throw new AuthFailure("AUTH_ORIGIN");
  if (embedded) {
    const { authentication } = await import("@microsoft/teams-js");
    async function teamsToken(silent: boolean) {
      try {
        const token = await authentication.getAuthToken({ silent, tenantId: config.tenantId });
        if (!token) throw new AuthFailure("AUTH_TEAMS_TOKEN");
        return token;
      } catch (error) {
        const code = typeof error === "string" ? error :
          error && typeof error === "object" && "errorCode" in error ? error.errorCode : undefined;
        if (code === "resourceRequiresConsent" || code === "interaction_required" ||
            code === "consent_required" || code === "invalid_grant")
          throw new AuthFailure("AUTH_INTERACTION");
        throw new AuthFailure("AUTH_TEAMS_TOKEN");
      }
    }
    return {
      token: async () => teamsToken(true),
      signIn: () => teamsToken(false),
      clear: async () => {},
    };
  }
  const client = new PublicClientApplication(msalConfiguration(config));
  await client.initialize();
  return {
    async signIn() {
      try {
        const result = await client.loginPopup({ scopes: [config.scope], redirectUri: config.redirectUri });
        if (!result.account || !result.accessToken) throw new AuthFailure();
        client.setActiveAccount(result.account);
        return result.accessToken;
      } catch {
        throw new AuthFailure("AUTH_POPUP");
      }
    },
    async token(forceRefresh) {
      const account = client.getActiveAccount();
      if (!account) throw new AuthFailure();
      try {
        const result = await client.acquireTokenSilent({ account, scopes: [config.scope], forceRefresh,
          redirectUri: config.redirectUri });
        if (!result.accessToken) throw new AuthFailure();
        return result.accessToken;
      } catch (error) {
        throw new AuthFailure(error instanceof InteractionRequiredAuthError ? "AUTH_INTERACTION" : "AUTH_TOKEN_UNAVAILABLE");
      }
    },
    async clear() {
      client.setActiveAccount(null);
      try { await client.clearCache(); }
      catch { throw new AuthFailure("AUTH_CLEAR"); }
    },
  };
}
