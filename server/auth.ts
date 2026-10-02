import { createRemoteJWKSet, jwtVerify, errors, type JWTVerifyGetKey, type JWTPayload } from "jose";
import { TEAMS_CLIENTS, uuid, type SsoConfig, type UserProfile } from "../shared/sso-config";

export type Identity = { tenantId: string; objectId: string; user: UserProfile };
export type TokenVerifier = (token: string) => Promise<Identity>;
export class AuthServiceFailure extends Error {
  constructor() { super("AUTH_SERVICE_UNAVAILABLE"); }
}
export class InvalidAccessToken extends Error {
  constructor() { super("AUTH_INVALID"); }
}
export function createTokenVerifier(config: SsoConfig, key?: JWTVerifyGetKey): TokenVerifier {
  const jwks = key ?? createRemoteJWKSet(
    new URL(`${config.authority}/discovery/v2.0/keys`),
    { timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 60 * 60_000 },
  );
  const clients = new Set<string>([config.clientId, ...TEAMS_CLIENTS]);
  return async token => {
    if (token.length > 16_384) throw new InvalidAccessToken();
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        algorithms: ["RS256"], issuer: `${config.authority}/v2.0`, audience: config.clientId,
        requiredClaims: ["exp", "nbf", "iat", "tid", "oid", "scp", "azp", "ver"],
        clockTolerance: 5,
      }));
    } catch (error) {
      if (!(error instanceof errors.JOSEError) || error instanceof errors.JWKSTimeout ||
          error.code === "ERR_JOSE_GENERIC") throw new AuthServiceFailure();
      throw new InvalidAccessToken();
    }
    if (payload.ver !== "2.0" || payload.aud !== config.clientId ||
        payload.tid !== config.tenantId || !uuid(payload.oid) ||
        typeof payload.iat !== "number" || payload.iat > Math.floor(Date.now() / 1000) + 5 ||
        typeof payload.scp !== "string" || !payload.scp.split(" ").includes("access_as_user") ||
        typeof payload.azp !== "string" || !clients.has(payload.azp)) throw new InvalidAccessToken();
    const user: UserProfile = {};
    if (typeof payload.name === "string" && payload.name.trim()) user.name = payload.name.trim();
    if (typeof payload.preferred_username === "string" && payload.preferred_username.trim())
      user.username = payload.preferred_username.trim();
    else if (typeof payload.upn === "string" && payload.upn.trim()) user.username = payload.upn.trim();
    return { tenantId: config.tenantId, objectId: payload.oid.toLowerCase(), user };
  };
}
