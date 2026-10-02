import { parseSsoConfig } from "../shared/sso-config";

// Identificadores sinteticos, sem registro ou credencial real.
export const ssoInput = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  origin: "https://tab.example.com",
};
export const config = parseSsoConfig(ssoInput);
export const packageInput = {
  appId: "33333333-3333-4333-8333-333333333333",
  developerName: "Organizacao Exemplo",
};
