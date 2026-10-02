// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { expectsTeams, initializeTeams, TEAMS_TIMEOUT_MS } from "../src/teams";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/"); });
it("detecta navegador top-level e marcador explicito do manifesto", () => {
  expect(expectsTeams()).toBe(false);
  window.history.replaceState({}, "", "/?host=teams");
  expect(expectsTeams()).toBe(true);
  window.history.replaceState({}, "", "/?host=browser");
  vi.stubGlobal("nativeInterface", { framelessPostMessage: vi.fn() });
  expect(expectsTeams()).toBe(true);
});
it("detecta iframe e janela com opener, sem depender de user-agent", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  expect(expectsTeams(frame.contentWindow!)).toBe(true);
  frame.remove();
  vi.stubGlobal("opener", {});
  expect(expectsTeams()).toBe(true);
});
it("navegador nao carrega TeamsJS; host so fica pronto apos initialize", async () => {
  const app = { initialize: vi.fn().mockResolvedValue(undefined) };
  const load = vi.fn().mockResolvedValue(app);
  expect(await initializeTeams(false, load)).toBe("browser");
  expect(load).not.toHaveBeenCalled();
  expect(await initializeTeams(true, load)).toBe("teams");
  expect(app.initialize).toHaveBeenCalledOnce();
});
it("falha de host nao seleciona browser como fallback", async () => {
  await expect(initializeTeams(true, async () => ({
    initialize: async () => { throw new Error("host error"); },
  }))).rejects.toMatchObject({ code: "AUTH_TEAMS_INIT" });
});
it("timeout de host ocorre no prazo e nao faz fallback", async () => {
  vi.useFakeTimers();
  const result = initializeTeams(true, async () => ({ initialize: () => new Promise(() => {}) }));
  const assertion = expect(result).rejects.toMatchObject({ code: "AUTH_TEAMS_TIMEOUT" });
  await vi.advanceTimersByTimeAsync(TEAMS_TIMEOUT_MS);
  await assertion;
});
