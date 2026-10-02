import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Ajv from "ajv-draft-04";
import addFormats from "ajv-formats";
import { strToU8, strFromU8, unzipSync, zipSync } from "fflate";
import { PNG } from "pngjs";
import { parseSsoConfig, uuid, type SsoConfig } from "../shared/sso-config";

const schema = JSON.parse(readFileSync(new URL("./schemas/MicrosoftTeams.schema.json", import.meta.url), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateManifest = ajv.compile(schema);

type PackageConfig = { appId: string; developerName: string };
export function parsePackageConfig(value: unknown): PackageConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PACKAGE_CONFIG_INVALID");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !["appId", "developerName"].includes(key)) ||
      !uuid(input.appId) || typeof input.developerName !== "string" ||
      !input.developerName.trim() || input.developerName.trim().length > 32 ||
      /[<>\u0000-\u001f]/.test(input.developerName)) throw new Error("PACKAGE_CONFIG_INVALID");
  return { appId: input.appId.toLowerCase(), developerName: input.developerName.trim() };
}

export function createManifest(sso: SsoConfig, installer: PackageConfig) {
  return {
    $schema: "https://developer.microsoft.com/json-schemas/teams/v1.23/MicrosoftTeams.schema.json",
    manifestVersion: "1.23",
    version: "1.0.0",
    id: installer.appId,
    developer: {
      name: installer.developerName, websiteUrl: `${sso.origin}/support.html`,
      privacyUrl: `${sso.origin}/privacy.html`, termsOfUseUrl: `${sso.origin}/terms.html`,
    },
    name: { short: "Personal Tab SSO", full: "Teams Personal Tab with SSO Example" },
    description: {
      short: "Exemplo de aba pessoal com Microsoft Entra ID e SSO.",
      full: "Exemplo educacional: entre com Microsoft no navegador ou com SSO no Teams e veja sua identidade validada pela API.",
    },
    icons: { outline: "outline.png", color: "color.png" },
    accentColor: "#334155",
    staticTabs: [{
      entityId: "personal-sso", name: "Inicio", contentUrl: `${sso.origin}/?host=teams`,
      websiteUrl: `${sso.origin}/`, scopes: ["personal"],
    }],
    validDomains: [new URL(sso.origin).hostname],
    webApplicationInfo: { id: sso.clientId, resource: sso.resource },
  };
}

function icon(size: number, outline: boolean): Uint8Array {
  const image = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inset = size / 4;
      const inside = x >= inset && x < size - inset && y >= inset && y < size - inset;
      const edge = inside && (x < inset + size / 16 || x >= size - inset - size / 16 ||
        y < inset + size / 16 || y >= size - inset - size / 16);
      const index = (y * size + x) * 4;
      image.data.set(edge ? [255, 255, 255, 255] :
        outline ? [0, 0, 0, 0] : [51, 65, 85, 255], index);
    }
  }
  return PNG.sync.write(image);
}

export function validatePackage(bytes: Uint8Array): void {
  const entries = unzipSync(bytes);
  if (Object.keys(entries).sort().join(",") !== "color.png,manifest.json,outline.png")
    throw new Error("PACKAGE_ENTRIES_INVALID");
  const manifest: unknown = JSON.parse(strFromU8(entries["manifest.json"]));
  if (!validateManifest(manifest)) throw new Error(`MANIFEST_INVALID: ${ajv.errorsText(validateManifest.errors)}`);
  for (const [name, size] of [["color.png", 192], ["outline.png", 32]] as const) {
    const image = PNG.sync.read(Buffer.from(entries[name]));
    if (image.width !== size || image.height !== size) throw new Error("PACKAGE_ICON_INVALID");
  }
}

export function buildPackage(ssoInput: unknown, packageInput: unknown): Uint8Array {
  const sso = parseSsoConfig(ssoInput);
  const installer = parsePackageConfig(packageInput);
  const bytes = zipSync({
    "manifest.json": strToU8(JSON.stringify(createManifest(sso, installer), null, 2)),
    "color.png": icon(192, false),
    "outline.png": icon(32, true),
  });
  validatePackage(bytes);
  return bytes;
}

async function main() {
  const [ssoPath = "sso-config.json", packagePath = "teams-package.json",
    output = join("appPackage", "teams-personal-tab.zip"), ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error("USAGE: npm run teams:package -- [sso.json] [teams.json] [saida.zip]");
  const bytes = buildPackage(JSON.parse(readFileSync(resolve(ssoPath), "utf8")),
    JSON.parse(readFileSync(resolve(packagePath), "utf8")));
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), bytes, { flag: "wx" });
  console.log("Pacote Teams criado e validado (manifesto 1.23 e icones).");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    console.error("PACKAGE_FAILED: confira os JSONs, caminhos e permissoes. A saida deve ser um arquivo novo.");
    process.exitCode = 1;
  });
}
