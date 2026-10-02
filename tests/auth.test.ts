import { beforeAll, describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { AuthServiceFailure, createTokenVerifier, InvalidAccessToken, type TokenVerifier } from "../server/auth";
import { TEAMS_CLIENTS } from "../shared/sso-config";
import { config } from "./fixtures";

let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let verify: TokenVerifier;
const claims = (): JWTPayload => ({
  iss: `${config.authority}/v2.0`, aud: config.clientId, tid: config.tenantId, ver: "2.0",
  oid: "44444444-4444-4444-8444-444444444444", scp: "access_as_user", azp: config.clientId,
  iat: Math.floor(Date.now() / 1000), nbf: Math.floor(Date.now() / 1000) - 10,
  exp: Math.floor(Date.now() / 1000) + 300,
  name: "Pessoa Exemplo", preferred_username: "pessoa@example.com",
});
async function sign(overrides: JWTPayload = {}, omit?: string) {
  const payload = { ...claims(), ...overrides };
  if (omit) delete payload[omit];
  return new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(keys.privateKey);
}
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  verify = createTokenVerifier(config, createLocalJWKSet({
    keys: [{ ...await exportJWK(keys.publicKey), kid: "test-key", alg: "RS256", use: "sig" }],
  }));
});
describe("validacao criptografica single-tenant", () => {
  it.each([config.clientId, ...TEAMS_CLIENTS])("aceita cliente autorizado %s", async azp => {
    expect(await verify(await sign({ azp }))).toEqual({
      tenantId: config.tenantId, objectId: claims().oid,
      user: { name: "Pessoa Exemplo", username: "pessoa@example.com" },
    });
  });
  it.each([
    ["expirado", { exp: 1 }], ["ainda nao valido", { nbf: 9_999_999_999 }],
    ["emitido no futuro", { iat: 9_999_999_999 }], ["audiencia Graph", { aud: "https://graph.microsoft.com" }],
    ["multiplas audiencias", { aud: [config.clientId, "other"] }],
    ["issuer", { iss: "https://issuer.example.com" }], ["tenant", { tid: "other" }],
    ["sem escopo delegado", { scp: "", roles: ["access_as_user"] }],
    ["substring de escopo", { scp: "not_access_as_user" }],
    ["cliente nao autorizado", { azp: "other" }], ["versao 1", { ver: "1.0" }],
    ["oid invalido", { oid: "not-a-guid" }],
  ] satisfies [string, JWTPayload][])("rejeita %s", async (_name, overrides) => {
    await expect(verify(await sign(overrides))).rejects.toBeInstanceOf(InvalidAccessToken);
  });
  it.each(["exp", "nbf", "iat", "tid", "oid", "scp", "azp", "ver", "aud", "iss"])(
    "exige claim %s", async claim => {
      await expect(verify(await sign({}, claim))).rejects.toBeInstanceOf(InvalidAccessToken);
    },
  );
  it("rejeita assinatura de outra chave", async () => {
    const other = await generateKeyPair("RS256");
    const token = await new SignJWT(claims()).setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(other.privateKey);
    await expect(verify(token)).rejects.toBeInstanceOf(InvalidAccessToken);
  });
  it("rejeita algoritmo nao permitido, JWT malformado e token excessivo", async () => {
    const token = await new SignJWT(claims()).setProtectedHeader({ alg: "HS256" }).sign(new Uint8Array(32));
    for (const invalid of [token, "invalid", "x".repeat(16_385)])
      await expect(verify(invalid)).rejects.toBeInstanceOf(InvalidAccessToken);
  });
  it("distingue indisponibilidade de JWKS de credencial invalida", async () => {
    const unavailable = createTokenVerifier(config, async () => { throw new TypeError("network"); });
    await expect(unavailable(await sign())).rejects.toBeInstanceOf(AuthServiceFailure);
  });
  it("aceita upn opcional sem usa-lo como chave de autorizacao", async () => {
    const identity = await verify(await sign({ upn: "pessoa@example.com" }, "preferred_username"));
    expect(identity.user.username).toBe("pessoa@example.com");
  });
});
