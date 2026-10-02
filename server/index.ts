import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "./app";
import { loadSsoConfig } from "./sso-config";

const root = resolve(import.meta.dirname, "..");
const config = loadSsoConfig(resolve(root, "sso-config.json"));
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT_INVALID");
const host = process.env.HOST ?? "127.0.0.1";
const directory = resolve(root, "dist");
try {
  await access(resolve(directory, "index.html"));
  await access(resolve(directory, "auth", "callback.html"));
} catch {
  throw new Error("BUILD_MISSING: execute npm run build antes de iniciar.");
}
const server = createApp(config, directory).listen(port, host, () => {
  console.log(`Servidor local na porta ${port}. Abra a origem HTTPS configurada; consulte o README.`);
});
server.on("error", () => {
  console.error("SERVER_LISTEN_FAILED: confira HOST, PORT e disponibilidade da porta.");
  process.exitCode = 1;
});
