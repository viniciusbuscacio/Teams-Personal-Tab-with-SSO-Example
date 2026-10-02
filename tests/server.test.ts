import { copyFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { AuthServiceFailure, createTokenVerifier, InvalidAccessToken } from "../server/auth";
import { config } from "./fixtures";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "personal-tab-test-"));
  await mkdir(join(directory, "auth"));
  await copyFile(new URL("../index.html", import.meta.url), join(directory, "index.html"));
  await copyFile(new URL("../auth/callback.html", import.meta.url), join(directory, "auth", "callback.html"));
  for (const page of ["support.html", "privacy.html", "terms.html"])
    await copyFile(new URL(`../public/${page}`, import.meta.url), join(directory, page));
});
afterAll(async () => { await rm(directory, { recursive: true }); });
const identity = { tenantId: config.tenantId, objectId: "synthetic", user: { name: "Pessoa" } };
describe("API e cabecalhos", () => {
  it("integra /api/me com verificacao criptografica real e rejeita token assinado sem escopo", async () => {
    const keys = await generateKeyPair("RS256");
    const verify = createTokenVerifier(config, createLocalJWKSet({
      keys: [{ ...await exportJWK(keys.publicKey), kid: "integration", alg: "RS256" }],
    }));
    const app = createApp(config, directory, verify);
    async function token(scope: string) {
      return new SignJWT({
        tid: config.tenantId, oid: "44444444-4444-4444-8444-444444444444",
        ver: "2.0", azp: config.clientId, scp: scope, name: "Pessoa Integracao",
        preferred_username: "integracao@example.com",
      }).setProtectedHeader({ alg: "RS256", kid: "integration" })
        .setIssuer(`${config.authority}/v2.0`).setAudience(config.clientId)
        .setIssuedAt().setNotBefore("0s").setExpirationTime("5m").sign(keys.privateKey);
    }
    const response = await request(app).get("/api/me")
      .set("Authorization", `Bearer ${await token("access_as_user")}`).expect(200);
    expect(response.body.user).toEqual({ name: "Pessoa Integracao", username: "integracao@example.com" });
    await request(app).get("/api/me").set("Authorization", `Bearer ${await token("User.Read")}`).expect(401);
  });
  it("exige Bearer antes de chamar o validador", async () => {
    const verify = vi.fn().mockResolvedValue(identity);
    const app = createApp(config, directory, verify);
    for (const header of ["", "Basic token", "Bearer", "Bearer a b"]) {
      const response = await request(app).get("/api/me").set("Authorization", header).expect(401);
      expect(response.body).toEqual({ code: "AUTH_REQUIRED", error: "An access token is required." });
    }
    expect(verify).not.toHaveBeenCalled();
  });
  it("retorna somente perfil depois da verificacao", async () => {
    const verify = vi.fn().mockResolvedValue(identity);
    const response = await request(createApp(config, directory, verify))
      .get("/api/me").set("Authorization", "Bearer synthetic").expect(200);
    expect(verify).toHaveBeenCalledWith("synthetic");
    expect(response.body).toEqual({ message: "Identity verified by the API using Microsoft Entra ID.", user: identity.user });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it.each<[Error, number]>([[new InvalidAccessToken(), 401], [new AuthServiceFailure(), 503], [new Error("unexpected"), 503]])(
    "nao transforma erro de validacao em sucesso", async (failure, status) => {
      const response = await request(createApp(config, directory, async () => { throw failure; }))
        .get("/api/me").set("Authorization", "Bearer synthetic").expect(status);
      expect(response.body.user).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain("unexpected");
      expect(response.body).toEqual(status === 401 ?
        { code: "AUTH_INVALID", error: "Invalid or expired token." } :
        { code: "AUTH_SERVICE_UNAVAILABLE", error: "Identity verification is unavailable. Try again later." });
    },
  );
  it("nao expoe outras APIs, configuracao local ou arquivos fonte", async () => {
    const app = createApp(config, directory, async () => identity);
    for (const path of ["/api/chat", "/api/users", "/api/history", "/api/me/extra"]) {
      const response = await request(app).get(path).set("Authorization", "Bearer synthetic").expect(404);
      expect(response.body).toEqual({ code: "NOT_FOUND", error: "API endpoint not found." });
    }
    for (const path of ["/sso-config.json", "/server/auth.ts", "/.env", "/.git/config"]) {
      const response = await request(app).get(path).expect(404);
      expect(response.body).toEqual({ code: "NOT_FOUND", error: "Page not found." });
    }
    const response = await request(app).post("/api/me").expect(405);
    expect(response.body).toEqual({ code: "METHOD_NOT_ALLOWED", error: "Use GET." });
  });
  it("configuracao publica contem somente IDs e origem", async () => {
    const response = await request(createApp(config, directory)).get("/api/auth-config").expect(200);
    expect(response.body).toEqual({ tenantId: config.tenantId, clientId: config.clientId, origin: config.origin });
  });
  it("bloqueia origem diferente sem habilitar CORS", async () => {
    const response = await request(createApp(config, directory))
      .get("/api/me").set("Origin", "https://untrusted.example.com").expect(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.body).toEqual({ code: "ORIGIN_DENIED", error: "Origin not allowed." });
  });
  it("permite embedding Teams e preserva a bridge MSAL sem COOP", async () => {
    const app = createApp(config, directory);
    const page = await request(app).get("/").expect(200);
    expect(page.headers["content-security-policy"]).toContain("https://*.cloud.microsoft");
    expect(page.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(page.headers["content-security-policy"]).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(page.headers["x-frame-options"]).toBeUndefined();
    const callback = await request(app).get("/auth/callback.html").expect(200);
    expect(callback.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(callback.headers["cross-origin-opener-policy"]).toBeUndefined();
  });

  it.each([
    ["/", "Teams Personal Tab with SSO Example", ""],
    ["/auth/callback.html", "Authentication callback", "Completing authentication..."],
  ])("serves English application HTML at %s", async (path, title, text) => {
    const response = await request(createApp(config, directory)).get(path).expect(200);
    expect(response.text).toContain('<html lang="en">');
    expect(response.text).toContain(`<title>${title}</title>`);
    if (text) expect(response.text).toContain(text);
  });

  it.each([
    ["/support.html", "About this example", "Teams Personal Tab with SSO Example",
      "An educational example of an HTTPS website in a Teams personal tab.",
      [["Privacy", "/privacy.html"], ["Terms", "/terms.html"], ["Home", "/"]]],
    ["/privacy.html", "Privacy for this example", "Privacy: educational template",
      "The browser's token cache is kept in memory.", [["Home", "/"]]],
    ["/terms.html", "Terms for this example", "Educational example, not a production service",
      "This page does not grant a license to the code.", [["Home", "/"]]],
  ] as const)("serves English informational content and navigation at %s", async (path, title, heading, text, links) => {
    const response = await request(createApp(config, directory)).get(path).expect(200);
    expect(response.text).toContain('<html lang="en">');
    expect(response.text).toContain(`<title>${title}</title>`);
    expect(response.text).toContain(`<h1>${heading}</h1>`);
    expect(response.text).toContain(text);
    for (const [label, href] of links)
      expect(response.text).toContain(`<a href="${href}">${label}</a>`);
  });
});
