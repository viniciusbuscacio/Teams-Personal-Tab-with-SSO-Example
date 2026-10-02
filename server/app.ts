import express from "express";
import { resolve } from "node:path";
import type { SsoConfig } from "../shared/sso-config";
import { InvalidAccessToken, createTokenVerifier, type TokenVerifier } from "./auth";

export function createApp(config: SsoConfig, staticDirectory: string, verify: TokenVerifier = createTokenVerifier(config)) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    const callback = req.path === "/auth/callback.html";
    const ancestors = callback ? "'self'" :
      "'self' https://teams.microsoft.com https://*.teams.microsoft.com https://*.cloud.microsoft";
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Strict-Transport-Security": "max-age=31536000",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; " +
        "connect-src 'self' https://login.microsoftonline.com https://res.cdn.office.net/teams-js/validDomains/json/validDomains.json; " +
        "frame-src 'self' https://login.microsoftonline.com; img-src 'self'; object-src 'none'; " +
        `base-uri 'none'; frame-ancestors ${ancestors}; form-action 'self'`,
    });
    if (callback) res.set("X-Frame-Options", "SAMEORIGIN");
    if (req.headers.origin && req.headers.origin !== config.origin)
      return res.status(403).json({ code: "ORIGIN_DENIED", error: "Origin not allowed." });
    next();
  });
  app.use("/api", async (req, res) => {
    if (req.method !== "GET") return res.status(405).set("Allow", "GET").json({
      code: "METHOD_NOT_ALLOWED", error: "Use GET.",
    });
    if (req.path === "/health") return res.json({ status: "ready" });
    if (req.path === "/auth-config") return res.json({
      tenantId: config.tenantId, clientId: config.clientId, origin: config.origin,
    });
    const match = /^Bearer ([^\s,]+)$/i.exec(req.headers.authorization ?? "");
    if (!match) return res.status(401).set("WWW-Authenticate", "Bearer").json({
      code: "AUTH_REQUIRED", error: "An access token is required.",
    });
    try {
      const identity = await verify(match[1]);
      if (req.path !== "/me") return res.status(404).json({ code: "NOT_FOUND", error: "API endpoint not found." });
      return res.json({ message: "Identity verified by the API using Microsoft Entra ID.", user: identity.user });
    } catch (error) {
      if (!(error instanceof InvalidAccessToken)) return res.status(503).json({
        code: "AUTH_SERVICE_UNAVAILABLE", error: "Identity verification is unavailable. Try again later.",
      });
      return res.status(401).set("WWW-Authenticate", 'Bearer error="invalid_token"').json({
        code: "AUTH_INVALID", error: "Invalid or expired token.",
      });
    }
  });
  // Somente o build e publico, nunca a raiz do projeto ou sua configuracao local.
  app.use(express.static(resolve(staticDirectory), { dotfiles: "deny", index: "index.html" }));
  app.use((_req, res) => res.status(404).json({ code: "NOT_FOUND", error: "Page not found." }));
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ code: "SERVER_ERROR", error: "An internal error occurred while processing the request." });
  });
  return app;
}
