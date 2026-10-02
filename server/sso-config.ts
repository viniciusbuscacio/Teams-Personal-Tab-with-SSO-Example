import { readFileSync } from "node:fs";
import { parseSsoConfig, type SsoConfig } from "../shared/sso-config";

export function loadSsoConfig(path: string): SsoConfig {
  try {
    return parseSsoConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    throw new Error("SSO_CONFIG_LOAD_FAILED: confira sso-config.json conforme o README; valores nao serao registrados.");
  }
}
