// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { AuthFailure } from "../src/auth-client";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(), prepare: vi.fn(), token: vi.fn(), signIn: vi.fn(), clear: vi.fn(),
}));
vi.mock("../src/teams", () => ({ initializeTeams: mocks.initialize }));
vi.mock("../src/authentication", () => ({ prepareAuthentication: mocks.prepare }));
const profile = { message: "Identity verified by the API using Microsoft Entra ID.", user: { name: "Pessoa Exemplo", username: "pessoa@example.com" } };

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  mocks.initialize.mockResolvedValue("teams");
  mocks.token.mockResolvedValue("synthetic-token");
  mocks.signIn.mockResolvedValue("interactive-token");
  mocks.clear.mockResolvedValue(undefined);
  mocks.prepare.mockResolvedValue({ token: mocks.token, signIn: mocks.signIn, clear: mocks.clear });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify(profile))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("duas telas e logout local", () => {
  it("usa SSO inicialmente no Teams e exige entrada explicita depois de sair, inclusive ao recarregar", async () => {
    const view = render(<App embedded />);
    await screen.findByText(/Pessoa Exemplo/);
    expect(screen.getByRole("region", { name: "Authenticated user" })).toBeTruthy();
    expect(screen.getByText("pessoa@example.com", { exact: true })).toBeTruthy();
    expect(screen.getByText("Identity verified by the API using Microsoft Entra ID.", { exact: true })).toBeTruthy();
    expect(screen.getByText("Signing out only clears this app's local state. Your Microsoft and Teams sessions remain signed in.", { exact: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign out of the app" }));
    await screen.findByRole("button", { name: "Sign in with Microsoft" });
    expect(screen.getByText("Teams personal tab", { exact: true })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Welcome" })).toBeTruthy();
    expect(screen.getByText("Sign in with the account you use in Teams.", { exact: true })).toBeTruthy();
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledOnce());
    expect(screen.queryByText("Pessoa Exemplo")).toBeNull();
    view.unmount();
    render(<App embedded />);
    await waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(2));
    expect(mocks.token).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Microsoft" }));
    await screen.findByText("Pessoa Exemplo");
    expect(mocks.signIn).toHaveBeenCalledOnce();
  });

  it("no navegador mostra login sem auto SSO e usa o token do popup", async () => {
    render(<App embedded={false} />);
    const button = await screen.findByRole("button", { name: "Sign in with Microsoft" });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    expect(screen.getByText("Browser", { exact: true })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Teams Personal Tab with SSO Example" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Welcome" })).toBeTruthy();
    expect(screen.getByText("Sign in with your Microsoft work account.", { exact: true })).toBeTruthy();
    expect(screen.getByRole("link", { name: "About this example" }).getAttribute("href")).toBe("/support.html");
    expect(mocks.token).not.toHaveBeenCalled();
    fireEvent.click(button);
    await screen.findByText("Pessoa Exemplo");
    expect(mocks.signIn).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/api/me", expect.objectContaining({
      headers: { Authorization: "Bearer interactive-token" },
    }));
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it("shows English loading and missing-claim text without replacing personal identity values", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ message: profile.message, user: {} })));
    render(<App embedded />);
    expect(screen.getByRole("status").textContent).toBe("Connecting...");
    expect(await screen.findByRole("heading", { level: 2, name: "Authenticated user" })).toBeTruthy();
    expect(screen.getByText("Sign-in identifier not provided by Microsoft Entra ID.", { exact: true })).toBeTruthy();
  });

  it.each([
    ["AUTH_REQUIRED", "Sign in with Microsoft to continue."],
    ["AUTH_ORIGIN", "Open the app at its configured HTTPS address."],
    ["AUTH_TOKEN_UNAVAILABLE", "Unable to obtain a Microsoft access token. Sign in again."],
    ["AUTH_TEAMS_TOKEN", "Teams did not provide an SSO token. Try signing in. If the issue persists, check permissions and configuration."],
    ["AUTH_TEAMS_INIT", "Unable to initialize the tab in Teams. Reopen the app in Teams."],
    ["AUTH_TEAMS_TIMEOUT", "Teams did not respond within 8 seconds during initialization. Reopen the app."],
    ["AUTH_INTERACTION", "Consent, multifactor authentication, or another sign-in is required. Select Sign in with Microsoft. If the issue persists, contact your administrator."],
    ["AUTH_POPUP", "Sign-in was not completed. Allow the Microsoft pop-up, complete authentication, and try again."],
    ["AUTH_STORAGE", "Session storage is unavailable. Allow it to stay signed out of the app after reloading."],
    ["AUTH_CLEAR", "Unable to clear the local cache. Close this tab before signing in again."],
    ["AUTH_BACKEND_401", "The API rejected the token after a second attempt. Check the tenant, audience, and scope."],
  ] as const)("shows English recovery guidance and preserves error code %s", async (code, text) => {
    mocks.initialize.mockRejectedValue(new AuthFailure(code));
    render(<App embedded />);
    expect((await screen.findByRole("alert")).textContent).toBe(`${text} [${code}]`);
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("shows safe English fallback guidance and lets the user retry", async () => {
    mocks.initialize.mockRejectedValueOnce(new Error("private failure details"));
    render(<App embedded />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Sign-in is unavailable. Check your connection, HTTPS, and configuration, then try again.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Pessoa Exemplo");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the profile cleared and explains local sign-out failures in English", async () => {
    render(<App embedded />);
    await screen.findByText("Pessoa Exemplo");
    mocks.clear.mockRejectedValueOnce(new Error("private cache details"));
    fireEvent.click(screen.getByRole("button", { name: "Sign out of the app" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Unable to clear the local cache. Close this tab before signing in again. [AUTH_CLEAR]",
    );
    expect(screen.queryByText("Pessoa Exemplo")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeTruthy();
  });

  it("nao converte erro do host em login pelo navegador", async () => {
    mocks.initialize.mockRejectedValue(new AuthFailure("AUTH_TEAMS_INIT"));
    render(<App embedded />);
    expect((await screen.findByRole("alert")).textContent).toContain("AUTH_TEAMS_INIT");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("limpa estado e cache quando a API continua retornando 401", async () => {
    vi.mocked(fetch).mockImplementation(async () => new Response("", { status: 401 }));
    render(<App embedded />);
    expect((await screen.findByRole("alert")).textContent).toContain("AUTH_BACKEND_401");
    expect(mocks.token).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(mocks.clear).toHaveBeenCalledOnce());
    expect(screen.queryByText("Pessoa Exemplo")).toBeNull();
  });

  it("ignora conclusao de autenticacao depois de desmontar", async () => {
    let finish!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<App embedded />);
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => { finish(new Response(JSON.stringify(profile))); });
    expect(screen.queryByText("Pessoa Exemplo")).toBeNull();
  });
});
