export const TEAMS_CLIENTS = [
  "1fec8e78-bce4-4aaf-ab1b-5451cc387264",
  "5e3ce6c0-2b1f-4285-8d4b-75ee78787346",
] as const;
export const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) &&
  value !== "00000000-0000-0000-0000-000000000000";
export type SsoConfig = {
  tenantId: string; clientId: string; origin: string; authority: string;
  resource: string; scope: string; redirectUri: string;
};
export type UserProfile = { name?: string; username?: string };
export type ProtectedResult = { message: string; user: UserProfile };

export function parseSsoConfig(value: unknown): SsoConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SSO_CONFIG_INVALID");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["tenantId", "clientId", "origin"].includes(key)) ||
      !uuid(input.tenantId) || !uuid(input.clientId) || typeof input.origin !== "string")
    throw new Error("SSO_CONFIG_INVALID");
  let url: URL;
  try { url = new URL(input.origin); } catch { throw new Error("SSO_CONFIG_INVALID"); }
  if (url.protocol !== "https:" || url.origin !== input.origin || url.port || url.username || url.password)
    throw new Error("SSO_CONFIG_INVALID");
  const tenantId = input.tenantId.toLowerCase();
  const clientId = input.clientId.toLowerCase();
  const resource = `api://${url.hostname}/${clientId}`;
  return { tenantId, clientId, origin: url.origin,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    resource, scope: `${resource}/access_as_user`, redirectUri: `${url.origin}/auth/callback.html` };
}
