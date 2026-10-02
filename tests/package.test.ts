import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PNG } from "pngjs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { buildPackage, parsePackageConfig, validatePackage } from "../scripts/teams-package";
import { parseSsoConfig } from "../shared/sso-config";
import { config, packageInput, ssoInput } from "./fixtures";

it("deriva autoridade, callback e escopo da API, nunca Graph", () => {
  expect(config.scope).toBe(`api://tab.example.com/${ssoInput.clientId}/access_as_user`);
  expect(config.redirectUri).toBe(`${ssoInput.origin}/auth/callback.html`);
  expect(config.authority).toBe(`https://login.microsoftonline.com/${ssoInput.tenantId}`);
});
it.each([
  "http://tab.example.com", "https://tab.example.com/", "https://tab.example.com/path",
  "https://tab.example.com?query=x", "https://tab.example.com#fragment",
  "https://tab.example.com:8443", "https://user:pass@tab.example.com", "not-a-url",
])("rejeita origem inconsistente %s", origin => {
  expect(() => parseSsoConfig({ ...ssoInput, origin })).toThrow("SSO_CONFIG_INVALID");
});
it.each([
  { ...ssoInput, tenantId: "common" }, { ...ssoInput, clientId: "00000000-0000-0000-0000-000000000000" },
  { ...ssoInput, clientSecret: "not-allowed" }, { ...ssoInput, scope: "User.Read" }, [], null,
])("rejeita configuracao invalida", value => {
  expect(() => parseSsoConfig(value)).toThrow("SSO_CONFIG_INVALID");
});
it("placeholders exigem substituicao e nao geram pacote aparentemente valido", () => {
  const sso = JSON.parse(readFileSync(new URL("../sso-config.example.json", import.meta.url), "utf8"));
  const installer = JSON.parse(readFileSync(new URL("../teams-package.example.json", import.meta.url), "utf8"));
  expect(() => buildPackage(sso, installer)).toThrow();
});
it.each([
  { ...packageInput, developerName: "<YOUR_ORGANIZATION>" }, { ...packageInput, developerName: "x".repeat(33) },
  { ...packageInput, developerName: "" }, { ...packageInput, appId: "invalid" },
  { ...packageInput, unexpected: true },
])("rejeita configuracao de instalador invalida", value => {
  expect(() => parsePackageConfig(value)).toThrow("PACKAGE_CONFIG_INVALID");
});
it("gera ZIP raiz com manifesto validado pelo schema oficial e icones corretos", () => {
  const bytes = buildPackage(ssoInput, packageInput);
  expect(() => validatePackage(bytes)).not.toThrow();
  const entries = unzipSync(bytes);
  expect(Object.keys(entries).sort()).toEqual(["color.png", "manifest.json", "outline.png"]);
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  expect(manifest.id).toBe(packageInput.appId);
  expect(manifest.webApplicationInfo).toEqual({ id: config.clientId, resource: config.resource });
  expect(manifest.validDomains).toEqual(["tab.example.com"]);
  expect(manifest.staticTabs).toEqual([{
    entityId: "personal-sso", name: "Inicio", contentUrl: "https://tab.example.com/?host=teams",
    websiteUrl: "https://tab.example.com/", scopes: ["personal"],
  }]);
  expect(manifest).not.toHaveProperty("bots");
  expect(manifest).not.toHaveProperty("permissions");
  const color = PNG.sync.read(Buffer.from(entries["color.png"]));
  const outline = PNG.sync.read(Buffer.from(entries["outline.png"]));
  expect([color.width, color.height]).toEqual([192, 192]);
  expect([outline.width, outline.height]).toEqual([32, 32]);
  expect(outline.data[3]).toBe(0);
  for (let i = 0; i < outline.data.length; i += 4)
    if (outline.data[i + 3]) expect([...outline.data.subarray(i, i + 4)]).toEqual([255, 255, 255, 255]);
});
it("validador rejeita entradas extras, manifesto invalido e icone com dimensao errada", () => {
  const entries = unzipSync(buildPackage(ssoInput, packageInput));
  expect(() => validatePackage(zipSync({ ...entries, "extra.txt": strToU8("x") }))).toThrow("PACKAGE_ENTRIES_INVALID");
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  manifest.manifestVersion = "invalid";
  expect(() => validatePackage(zipSync({ ...entries, "manifest.json": strToU8(JSON.stringify(manifest)) })))
    .toThrow("MANIFEST_INVALID");
  expect(() => validatePackage(zipSync({ ...entries, "color.png": entries["outline.png"] })))
    .toThrow("PACKAGE_ICON_INVALID");
});
