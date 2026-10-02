// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://tab.example.com/"}
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserCacheLocation, InteractionRequiredAuthError } from "@azure/msal-browser";
import { prepareAuthentication, msalConfiguration } from "../src/authentication";
import { loadProfile } from "../src/auth-client";
import { config, ssoInput } from "./fixtures";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(), loginPopup: vi.fn(), acquireTokenSilent: vi.fn(),
  setActiveAccount: vi.fn(), getActiveAccount: vi.fn(), clearCache: vi.fn(), getAuthToken: vi.fn(),
  broadcastResponse: vi.fn(),
}));
vi.mock("@azure/msal-browser", async importOriginal => ({
  ...await importOriginal<typeof import("@azure/msal-browser")>(),
  PublicClientApplication: class {
    initialize = mocks.initialize;
    loginPopup = mocks.loginPopup;
    acquireTokenSilent = mocks.acquireTokenSilent;
    setActiveAccount = mocks.setActiveAccount;
    getActiveAccount = mocks.getActiveAccount;
    clearCache = mocks.clearCache;
  },
}));
vi.mock("@microsoft/teams-js", () => ({ authentication: { getAuthToken: mocks.getAuthToken } }));
vi.mock("@azure/msal-browser/redirect-bridge", () => ({
  broadcastResponseToMainFrame: mocks.broadcastResponse,
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.initialize.mockResolvedValue(undefined);
  mocks.clearCache.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify(ssoInput))));
});
afterEach(() => vi.unstubAllGlobals());

it("MSAL usa memoria, autoridade single-tenant e bridge; sem broker ou redirect no iframe", () => {
  const options = msalConfiguration(config);
  expect(options.auth).toEqual({ clientId: config.clientId, authority: config.authority, redirectUri: config.redirectUri });
  expect(options.cache?.cacheLocation).toBe(BrowserCacheLocation.MemoryStorage);
  expect(options.system?.allowRedirectInIframe).toBe(false);
  expect(options.system?.allowPlatformBroker).toBe(false);
});
it("browser inicia por popup com escopo proprio e limpa apenas cache local", async () => {
  const account = { homeAccountId: "synthetic" };
  mocks.loginPopup.mockResolvedValue({ account, accessToken: "synthetic" });
  mocks.getActiveAccount.mockReturnValue(account);
  mocks.acquireTokenSilent.mockResolvedValue({ accessToken: "renewed" });
  const auth = await prepareAuthentication(false);
  expect(mocks.loginPopup).not.toHaveBeenCalled();
  expect(await auth.signIn()).toBe("synthetic");
  expect(mocks.loginPopup).toHaveBeenCalledWith({ scopes: [config.scope], redirectUri: config.redirectUri });
  expect(await auth.token(true)).toBe("renewed");
  expect(mocks.acquireTokenSilent).toHaveBeenCalledWith(expect.objectContaining({ forceRefresh: true }));
  await auth.clear();
  expect(mocks.setActiveAccount).toHaveBeenLastCalledWith(null);
  expect(mocks.clearCache).toHaveBeenCalledOnce();
  expect(mocks.getAuthToken).not.toHaveBeenCalled();
});
it("Teams usa token do host, permite interacao explicita e nao mantem cache proprio", async () => {
  mocks.getAuthToken.mockResolvedValue("teams-token");
  const auth = await prepareAuthentication(true);
  expect(await auth.token(false)).toBe("teams-token");
  expect(mocks.getAuthToken).toHaveBeenLastCalledWith({ silent: true, tenantId: config.tenantId });
  expect(await auth.signIn()).toBe("teams-token");
  expect(mocks.getAuthToken).toHaveBeenLastCalledWith({ silent: false, tenantId: config.tenantId });
  await auth.clear();
  expect(mocks.clearCache).not.toHaveBeenCalled();
  expect(mocks.initialize).not.toHaveBeenCalled();
});
it.each(["resourceRequiresConsent", "interaction_required", "consent_required", "invalid_grant"])(
  "Teams informa necessidade de interacao para %s", async code => {
    mocks.getAuthToken.mockRejectedValue(code);
    const auth = await prepareAuthentication(true);
    await expect(auth.token(false)).rejects.toMatchObject({ code: "AUTH_INTERACTION" });
    expect(mocks.loginPopup).not.toHaveBeenCalled();
  },
);
it("erro arbitrario Teams nao expõe detalhes nem inicia MSAL", async () => {
  mocks.getAuthToken.mockRejectedValue(new Error("sensitive-detail"));
  const auth = await prepareAuthentication(true);
  await expect(auth.signIn()).rejects.toMatchObject({ code: "AUTH_TEAMS_TOKEN" });
  expect(mocks.initialize).not.toHaveBeenCalled();
});
it("popup cancelado e interacao MSAL sao erros explicitos", async () => {
  mocks.loginPopup.mockRejectedValue(new Error("cancelled"));
  mocks.getActiveAccount.mockReturnValue({});
  mocks.acquireTokenSilent.mockRejectedValue(new InteractionRequiredAuthError("interaction_required", "Interaction required"));
  const auth = await prepareAuthentication(false);
  await expect(auth.signIn()).rejects.toMatchObject({ code: "AUTH_POPUP" });
  await expect(auth.token(true)).rejects.toMatchObject({ code: "AUTH_INTERACTION" });
});
it("rejeita origem diferente da configurada", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ...ssoInput, origin: "https://other.example.com" })));
  await expect(prepareAuthentication(false)).rejects.toMatchObject({ code: "AUTH_ORIGIN" });
});
it("401 renova uma unica vez e nunca coloca token na URL ou cookies", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ user: { name: "Pessoa" }, message: "OK" })));
  const source = { signIn: vi.fn(), token: vi.fn().mockResolvedValue("new-token"), clear: vi.fn() };
  await expect(loadProfile(source, undefined, "initial-token")).resolves.toMatchObject({ user: { name: "Pessoa" } });
  expect(source.token).toHaveBeenCalledExactlyOnceWith(true);
  expect(fetch).toHaveBeenLastCalledWith("/api/me", expect.objectContaining({
    credentials: "omit", redirect: "error", cache: "no-store", headers: { Authorization: "Bearer new-token" },
  }));
});
it("abort impede envio de token depois de uma operacao obsoleta", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(loadProfile({ token: vi.fn(), signIn: vi.fn(), clear: vi.fn() }, controller.signal)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it.each([
  [new Response("", { status: 503 }), "The API is unavailable (HTTP 503). Try again later."],
  [new Response(JSON.stringify({ message: "ok", user: [] })), "Unexpected API response."],
  [new Response(JSON.stringify({ message: "ok", user: { name: 1 } })), "Unexpected profile returned by the API."],
])(
  "nao fabrica usuario quando a resposta nao e valida", async (response, message) => {
    vi.mocked(fetch).mockResolvedValue(response);
    await expect(loadProfile({ token: vi.fn().mockResolvedValue("synthetic"), signIn: vi.fn(), clear: vi.fn() })).rejects.toThrow(message);
  },
);

it("explains unavailable SSO configuration in English", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("", { status: 503 }));
  await expect(prepareAuthentication(false)).rejects.toThrow("SSO is not configured. Check the server configuration.");
});

it("shows English recovery guidance when the authentication callback fails", async () => {
  mocks.broadcastResponse.mockRejectedValue(new Error("private bridge details"));
  const previousContent = document.body.innerHTML;
  try {
    await import("../src/auth-callback");
    await vi.waitFor(() => expect(document.body.textContent).toBe(
      "Unable to complete authentication. Close this window and try again.",
    ));
  } finally {
    document.body.innerHTML = previousContent;
  }
});
