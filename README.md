# Teams Personal Tab with SSO Example

[Este documento está disponível em português clicando aqui](README-PTBR.md)

An educational example with **two simple Bootstrap screens**: sign-in and an
authenticated profile with **Sign out of the app**. The same website and API work
in the browser and as a Teams personal tab.

Inspired by Microsoft's [Personal Tab SSO Quickstart](https://github.com/OfficeDev/Microsoft-Teams-Samples/tree/main/samples/TeamsJS/tab-personal-sso-quickstart/ts).
This implementation was written for this example; it is neither a copy of the
quickstart nor a Microsoft-endorsed product. It does not use bots, Graph,
OBO, a database, AI, client secrets, or password collection.

## How it works

| Context | Sign-in | Sign-out |
| --- | --- | --- |
| Browser | **Sign in with Microsoft** opens the official Entra ID sign-in page in a popup; MSAL uses the authorization code flow with PKCE. | Clears the profile and local MSAL cache without triggering a global sign-out. |
| Teams | Initializes TeamsJS and tries `getAuthToken({ silent: true })`. The button allows another attempt with host interaction when needed. | Clears the example's profile; does not end the Teams session or remove its SSO cache. |

The frontend sends the access token only in the `Authorization: Bearer` header
to `GET /api/me`. The server validates the RS256 signature through JWKS, v2 issuer,
tenant, exact API audience, token validity period, `oid`, authorized client,
and delegated `access_as_user` scope. Graph tokens and app-only tokens are
rejected. The name and sign-in identifier are for display; the identity used
for authorization is the combination of `tid` and `oid`.
The authenticated screen appears only after a valid API response.

Tokens stay in memory, never in URLs, logs, or a database. Only a boolean
local sign-out marker is written to `sessionStorage`; it prevents immediate
automatic sign-in, including when reloading the same tab. A new tab or session
can use SSO again. This **does not revoke tokens**, end the Microsoft session,
or replace a corporate sign-out policy. A subsequent explicit sign-in may reuse
the Microsoft session without prompting for a password.

Initial browser screen, with sign-in using a Microsoft work account:

![Initial browser screen with the Sign in with Microsoft button.](docs/images/browser-sign-in.png)

## Requirements

- Node.js **24 LTS**, npm, and a current browser.
- For real authentication: a Microsoft Entra ID tenant, a user in that tenant,
  permission to register/configure an application, and consent according to
  the organization's policy.
- For Teams: HTTPS with a trusted certificate, a configurable domain
  (a development tunnel is fine), and permission to upload custom apps.
  Azure hosting is not required.

`npm test` and `npm run build` **do not require a tenant, tunnel, or real configuration**.
Tests use synthetic IDs and keys.

## 1. Register a single application in Entra ID

Choose your HTTPS origin, such as `https://tab.example.com`, with no path,
trailing slash, or non-default port. The examples below are placeholders.

1. In the [Microsoft Entra admin center](https://entra.microsoft.com), open
   **App registrations > New registration**. Choose **Accounts in this
   organizational directory only (Single tenant)**. Note the **Directory
   (tenant) ID** and **Application (client) ID**.
2. Under **Manifest**, set `api.requestedAccessTokenVersion` to `2`.
   Preserve the registration's other properties.
3. Under **Authentication > Add a platform > Single-page application (SPA)**,
   register exactly `https://tab.example.com/auth/callback.html`.
   Do not select Web, enable implicit grant, enable public client flows,
   or create a secret/certificate for this example.
4. Under **Expose an API**, set the Application ID URI to
   `api://tab.example.com/<APPLICATION_CLIENT_ID>`.
   The domain must match the one hosting the tab. If an identifier or consent
   policy prevents this configuration, ask your administrator for help;
   do not weaken API validation.
5. Add and enable the **`access_as_user`** scope. Suggested consent display
   name: "Access the example as a user"; description: "Allows users to view
   their own name and sign-in identifier in this example".
   Set who can consent according to the tenant's policy; if it is
   **Admins only**, an administrator must grant consent.
6. Under **API permissions > Add a permission > My APIs**, select this same
   registration, then **Delegated permissions > access_as_user**. Grant
   administrator consent if required by policy. Remove the default Graph
   `User.Read` permission if present: the example does not call Graph.
   MSAL may request the standard protocol scopes `openid`, `profile`,
   and `offline_access`.
7. Under **Expose an API > Authorized client applications**, add the two
   official IDs below and select `access_as_user` for each:

   | Teams client | Official public ID |
   | --- | --- |
   | Desktop/mobile | `1fec8e78-bce4-4aaf-ab1b-5451cc387264` |
   | Web | `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` |

8. If the token does not include `preferred_username`, configure the optional
   **`upn`** claim for **Access tokens**, if available in your tenant. The API
   accepts `preferred_username` or `upn`; when both are missing, the screen
   reports their absence instead of inventing an email address. Display claims
   are not authorization keys.

The browser and API use the same client ID, corresponding to a single registration;
the v2 token audience expected by the API is this **GUID**, not the `api://...` URI.
The requested scope is `api://tab.example.com/<APPLICATION_CLIENT_ID>/access_as_user`.

Application registration overview in Microsoft Entra ID, with identifiers
and the Application ID URI hidden:

![App Registration overview in Microsoft Entra ID, with IDs and the Application ID URI hidden.](docs/images/entra-app-registration.png)

## 2. Configure and run locally

In the project folder, using PowerShell:

```powershell
npm install
Copy-Item sso-config.example.json sso-config.json
Copy-Item teams-package.example.json teams-package.json
```

Edit `sso-config.json` with the values from your registration:

```json
{
  "tenantId": "<DIRECTORY_TENANT_ID>",
  "clientId": "<APPLICATION_CLIENT_ID>",
  "origin": "https://tab.example.com"
}
```

In `teams-package.json`, enter the actual developer or organization name and a
**new GUID for the Teams app**, conceptually separate from the Entra registration.
To generate this GUID, use `[guid]::NewGuid()`:

```json
{
  "appId": "<NEW_TEAMS_APP_GUID>",
  "developerName": "<YOUR_ORGANIZATION>"
}
```

Actual configuration files, builds, and ZIPs are ignored by Git. Placeholders
deliberately **fail** configuration validation.
Do not put secrets in these files.

```powershell
npm test
npm run build
npm start
```

The server listens only on `127.0.0.1:3000` by default. `PORT` and `HOST`
can be set through the environment when required by the hosting platform.
`npm run dev` builds the interface and restarts the server when its TypeScript
files change; **restart this command to rebuild interface changes**.
It is not a Vite server with HMR.

Sign-in requires the configured HTTPS origin, even in the browser. To test
with Teams, configure an HTTPS tunnel yourself that forwards to
`http://127.0.0.1:3000`; no command in this project creates resources or tunnels.
Avoid a proxy that intercepts authentication, injects scripts, or modifies
headers. Do not expose the project root: serve only through Express and `dist`.

If the domain changes, update `origin`, the SPA redirect URI, Application ID URI,
Entra scope/permission, and Teams package **together**. Restart the server and
import the package again. Content and API remain on the same origin;
there is no open CORS configuration or authentication bypass mode.

## 3. Generate and import the Teams app

```powershell
npm run teams:package
```

The command creates `appPackage\teams-personal-tab.zip`, containing `manifest.json`,
`color.png` (192 x 192), and `outline.png` (32 x 32) at the root. The geometric
icons are generated by this project and contain no Microsoft branding.
The generator validates the **1.23** manifest against a local copy of the official
schema, checks dimensions, and refuses to overwrite an existing ZIP. For another output:

```powershell
npm run teams:package -- sso-config.json teams-package.json appPackage\personal-tab-v2.zip
```

The manifest uses `staticTabs` with the `personal` scope, `webApplicationInfo`
from the Entra registration, and `validDomains` containing only the configured domain.
The `?host=teams` parameter requests SDK initialization; it **does not authenticate**.
Frames and native hosts are also detected; an SDK failure does not silently trigger
browser sign-in. Open the URL without this parameter to test in a regular browser.

In Teams, use **Apps > Manage your apps > Upload an app > Upload a custom
app** (labels may vary) and select the ZIP. If the option does not appear,
an administrator must allow custom app upload/use according to app management,
setup, and availability policies. Local ZIP validation does not guarantee
approval under those policies or publication in the catalog.

Authenticated profile in the app installed as a Teams personal tab:

![Personal Tab SSO app open in Teams, showing the user's name, a hidden email address, and identity confirmation from the API.](docs/images/teams-sso-profile.png)

Before distributing, replace the example support, privacy, and terms pages
with the appropriate contacts and text for your organization.

## Validation and troubleshooting

```powershell
npm run typecheck
npm test
npm run build
```

Tests cover signatures with synthetic JWKS, audience/issuer/tenant,
expiration, delegated scope, clients, API requests without a token, dependency
failures, both screens, local sign-out, stale responses, 401s, popup and Teams
errors, configuration validation, schema validation, and ZIP contents.
No linter is configured.

Expected real-world checks after configuring your environment:

1. Browser: sign-in screen, official Microsoft popup, consent/MFA when required,
   and a profile confirmed by the API.
2. Teams web, desktop, and mobile: SSO using the host account; if interaction
   is required, select **Sign in with Microsoft**. Persistent consent/MFA failures
   may require administrator action or signing in to Teams again;
   there is no password, Graph, or NAA fallback.
3. Both: **Sign out of the app** returns to the sign-in screen; reloading the
   same tab does not sign in automatically. Selecting sign-in allows authentication again.

| Symptom | What to check |
| --- | --- |
| `SSO_CONFIG_LOAD_FAILED` | Local file, GUIDs, exact HTTPS origin, and absence of extra fields. |
| `AUTH_ORIGIN` | Open the configured origin, not `localhost` or another domain. |
| `AUTH_TEAMS_INIT` / `AUTH_TEAMS_TIMEOUT` | Reopen in Teams; check SDK loading, CSP, and the host's network connection. |
| `AUTH_INTERACTION` / `AUTH_TEAMS_TOKEN` | Consent, preauthorized clients, account tenant, scope, and `webApplicationInfo`. |
| `AUTH_POPUP` | Allow popups; complete sign-in/consent/MFA without closing the window. |
| `AUTH_BACKEND_401` | v2 token, API GUID audience, tenant, scope, and server clock. Teams may return the same cached token on the second attempt. |
| HTTP 503 | The API could not validate the identity; check access to `login.microsoftonline.com`/JWKS. Do not accept unsigned tokens. |
| `AUTH_STORAGE` / `AUTH_CLEAR` | Allow session storage; if clearing fails, close the tab. |
| `PACKAGE_FAILED` | Placeholders, developer name (1 to 32 characters), paths/permissions, or an existing ZIP. |

The CSP allows the documented Teams hosts and Entra for authentication.
The `/auth/callback.html` page is a separate MSAL bridge with
`frame-ancestors 'self'` and no COOP. Do not configure the proxy to add
COOP to this page or `X-Frame-Options: DENY/SAMEORIGIN` to the main tab.
Do not enable HTTP logs that record `Authorization`, OAuth codes, or tokens.

**Evidence limitations:** local tests use SDK mocks and synthetic keys;
they do not prove real sign-in, corporate policy compliance, popup behavior,
or compatibility with every Teams client. Run the manual checklist above
in your chosen tenant before distributing.

## References and rights

- [Tab SSO overview](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-overview)
- [Entra registration and authorized Teams clients](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-register-aad)
- [TeamsJS: obtain and validate a token](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-code)
- [MSAL Browser v5: redirect bridge](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge)
- [CSP and tab requirements](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/tab-requirements)
- [Official manifest schema 1.23](https://developer.microsoft.com/json-schemas/teams/v1.23/MicrosoftTeams.schema.json),
  retrieved on September 30, 2026, and preserved in `scripts\schemas\MicrosoftTeams.schema.json`
  for offline validation; a third-party Microsoft artifact, not authored by this project.

Third-party libraries and the schema retain their original rights and terms.
A publication license for the new code **has not yet been chosen**;
this project does not grant its own license by implication. Review licensing
and attribution before publishing a public repository.
