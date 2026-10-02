import { AuthFailure } from "./auth-client";

export type HostMode = "browser" | "teams";
type TeamsApp = { initialize: () => Promise<void> };
export const TEAMS_TIMEOUT_MS = 8000;

export function expectsTeams(host: Window = window): boolean {
  return new URLSearchParams(host.location.search).get("host") === "teams" ||
    host.parent !== host || Boolean(host.opener) || "nativeInterface" in host;
}

export async function initializeTeams(
  expected: boolean,
  load: () => Promise<TeamsApp> = async () => (await import("@microsoft/teams-js")).app,
): Promise<HostMode> {
  if (!expected) return "browser";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      load().then(app => app.initialize()),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("TEAMS_INIT_TIMEOUT")), TEAMS_TIMEOUT_MS);
      }),
    ]);
    return "teams";
  } catch (error) {
    const timeout = error instanceof Error && error.message === "TEAMS_INIT_TIMEOUT";
    throw new AuthFailure(timeout ? "AUTH_TEAMS_TIMEOUT" : "AUTH_TEAMS_INIT");
  } finally {
    clearTimeout(timer);
  }
}
