# Teams Personal Tab with SSO Example

Exemplo educacional com **duas telas simples em Bootstrap**: login e perfil
autenticado com **Sair do aplicativo**. O mesmo site e a mesma API funcionam
no navegador e como aba pessoal do Teams.

Inspirado no [Personal Tab SSO Quickstart da Microsoft](https://github.com/OfficeDev/Microsoft-Teams-Samples/tree/main/samples/TeamsJS/tab-personal-sso-quickstart/ts).
Esta implementacao foi escrita para este exemplo; nao e uma copia do
quickstart nem um produto endossado pela Microsoft. Nao utiliza bot, Graph,
OBO, banco de dados, IA, client secret ou captura de senhas.

## Como funciona

| Contexto | Entrada | Saida |
| --- | --- | --- |
| Navegador | **Entrar com Microsoft** abre o Entra ID oficial em popup; MSAL usa authorization code com PKCE. | Limpa perfil e cache MSAL local, sem chamar logout global. |
| Teams | Inicializa TeamsJS e tenta `getAuthToken({ silent: true })`. O botao permite nova tentativa com interacao do host quando necessaria. | Limpa o perfil do exemplo; nao encerra Teams nem remove seu cache SSO. |

O frontend envia o access token apenas no cabecalho `Authorization: Bearer`
para `GET /api/me`. O servidor valida assinatura RS256 via JWKS, issuer v2,
tenant, audiencia exata da API, validade temporal, `oid`, cliente autorizado
e escopo delegado `access_as_user`. Tokens Graph e tokens app-only sao
recusados. Nome/login sao informativos; identidade de autorizacao e `tid` + `oid`.
A tela so aparece autenticada apos resposta valida da API.

Tokens ficam em memoria, nao em URLs, logs ou banco. Somente um marcador
booleano de saida local e gravado em `sessionStorage`; ele impede login
automatico imediato, inclusive ao recarregar a mesma aba. Nova aba/sessao
pode usar SSO novamente. Isso **nao revoga tokens**, nao encerra a sessao
Microsoft e nao substitui uma politica de logout corporativo. A nova entrada
explicita pode reaproveitar a sessao Microsoft sem pedir senha.

## Requisitos

- Node.js **24 LTS**, npm e um navegador atual.
- Para autenticacao real: tenant Microsoft Entra ID, usuario desse tenant,
  permissao para registrar/configurar um aplicativo e consentimento conforme
  a politica da organizacao.
- Para Teams: HTTPS com certificado confiavel, um dominio configuravel
  (pode ser um tunel de desenvolvimento) e permissao para carregar apps
  personalizados. Nao e necessario hospedar no Azure.

`npm test` e `npm run build` **nao precisam de tenant, tunel ou configuracao real**.
Os testes utilizam IDs e chaves sinteticos.

## 1. Registrar um unico aplicativo no Entra ID

Defina sua origem HTTPS, por exemplo `https://tab.example.com`, sem caminho,
barra final ou porta nao padrao. Os exemplos abaixo sao placeholders.

1. No [Microsoft Entra admin center](https://entra.microsoft.com), abra
   **App registrations > New registration**. Escolha **Accounts in this
   organizational directory only (Single tenant)**. Anote **Directory
   (tenant) ID** e **Application (client) ID**.
2. Em **Manifest**, configure `api.requestedAccessTokenVersion` como `2`.
   Preserve as demais propriedades do registro.
3. Em **Authentication > Add a platform > Single-page application (SPA)**,
   registre exatamente `https://tab.example.com/auth/callback.html`.
   Nao selecione Web, nao habilite implicit grant, nao habilite public client
   flows e nao crie segredo/certificado para este exemplo.
4. Em **Expose an API**, configure o Application ID URI como
   `api://tab.example.com/<APPLICATION_CLIENT_ID>`.
   O dominio deve ser o mesmo que hospeda a aba. Se uma politica de
   identificadores/consentimento impedir a configuracao, solicite apoio do
   administrador; nao relaxe a validacao da API.
5. Adicione e habilite o escopo **`access_as_user`**. Sugestao de nome de
   consentimento: "Acessar o exemplo como usuario"; descricao: "Permite
   consultar o proprio nome e identificador de entrada neste exemplo".
   Defina quem pode consentir conforme a politica do tenant; se for
   **Admins only**, o administrador precisa conceder consentimento.
6. Em **API permissions > Add a permission > My APIs**, selecione este
   proprio registro, **Delegated permissions > access_as_user**. Conceda
   consentimento administrativo se exigido pela politica. Remova a
   permissao Graph `User.Read` criada por padrao se estiver presente:
   o exemplo nao chama Graph. MSAL pode solicitar os escopos padrao
   de protocolo `openid`, `profile` e `offline_access`.
7. Em **Expose an API > Authorized client applications**, adicione os
   dois IDs oficiais abaixo e marque `access_as_user` para cada um:

   | Cliente Teams | ID publico oficial |
   | --- | --- |
   | Desktop/mobile | `1fec8e78-bce4-4aaf-ab1b-5451cc387264` |
   | Web | `5e3ce6c0-2b1f-4285-8d4b-75ee78787346` |

8. Se o token nao incluir `preferred_username`, configure o optional claim
   **`upn`** para **Access tokens**, se disponivel em seu tenant. A API aceita
   `preferred_username` ou `upn`; quando nenhum vier, a tela informa a ausencia
   em vez de inventar um email. Claims de exibicao nao sao chaves de autorizacao.

O client ID do navegador e o da API sao o mesmo registro; a audiencia dos
tokens v2 esperada pela API e esse **GUID**, nao o URI `api://...`.
O escopo solicitado e `api://tab.example.com/<APPLICATION_CLIENT_ID>/access_as_user`.

## 2. Configurar e executar localmente

Na pasta do projeto, usando PowerShell:

```powershell
npm install
Copy-Item sso-config.example.json sso-config.json
Copy-Item teams-package.example.json teams-package.json
```

Edite `sso-config.json` com os valores do seu registro:

```json
{
  "tenantId": "<DIRECTORY_TENANT_ID>",
  "clientId": "<APPLICATION_CLIENT_ID>",
  "origin": "https://tab.example.com"
}
```

Em `teams-package.json`, informe o nome real do responsavel e um **novo
GUID para o aplicativo Teams**, distinto conceitualmente do registro Entra.
Para gerar esse GUID, use `[guid]::NewGuid()`:

```json
{
  "appId": "<NEW_TEAMS_APP_GUID>",
  "developerName": "<YOUR_ORGANIZATION>"
}
```

Os arquivos reais, builds e ZIPs sao ignorados pelo Git. Placeholders
deliberadamente **nao passam** na validacao de configuracao.
Nao coloque segredos nesses arquivos.

```powershell
npm test
npm run build
npm start
```

O servidor escuta apenas `127.0.0.1:3000` por padrao. `PORT` e `HOST`
podem ser definidos pelo ambiente quando a hospedagem exigir.
`npm run dev` constroi a interface e reinicia o servidor ao alterar seus
arquivos TypeScript; **reinicie esse comando para reconstruir alteracoes
na interface**. Nao e um servidor Vite com HMR.

O login requer a origem HTTPS configurada, mesmo no navegador. Para testar
com Teams, configure por sua conta um tunel HTTPS que encaminhe para
`http://127.0.0.1:3000`; nenhum comando deste projeto cria recursos ou tuneis.
Evite proxy que intercepte autenticacao, injete scripts ou modifique
cabecalhos. Nao exponha a raiz do projeto: somente o Express e `dist`.

Se o dominio mudar, atualize **juntos** `origin`, redirect URI SPA, Application
ID URI, escopo/permissao no Entra e pacote Teams. Reinicie o servidor e
importe novamente o pacote. Conteudo e API permanecem na mesma origem;
nao existe CORS aberto nem modo que ignore autenticacao.

## 3. Gerar e importar o aplicativo Teams

```powershell
npm run teams:package
```

O comando cria `appPackage\teams-personal-tab.zip`, com `manifest.json`,
`color.png` (192 x 192) e `outline.png` (32 x 32) na raiz. Os icones
geometricos sao gerados por este projeto, sem marca Microsoft.
O gerador valida o manifesto **1.23** com uma copia local do schema oficial,
confere dimensoes e recusa sobrescrever um ZIP existente. Para outra saida:

```powershell
npm run teams:package -- sso-config.json teams-package.json appPackage\personal-tab-v2.zip
```

O manifesto usa `staticTabs` com escopo `personal`, `webApplicationInfo`
do registro Entra e `validDomains` com somente o dominio configurado.
O parametro `?host=teams` solicita inicializacao do SDK, **nao autentica**.
Frames e hosts nativos tambem sao reconhecidos; falha do SDK nao aciona
login de navegador silenciosamente. Abra a URL sem esse parametro para
testar no navegador normal.

No Teams, use **Apps > Manage your apps > Upload an app > Upload a custom
app** (rotulos podem variar) e selecione o ZIP. Se a opcao nao aparecer,
o administrador precisa liberar upload/uso de apps personalizados conforme
as politicas de gerenciamento, configuracao e disponibilidade de apps.
Validar o ZIP localmente nao garante aprovacao dessas politicas nem
publicacao no catalogo.

Antes de distribuir, substitua as paginas de exemplo de suporte,
privacidade e termos pelos contatos e textos adequados da organizacao.

## Validacao e diagnostico

```powershell
npm run typecheck
npm test
npm run build
```

Os testes cobrem assinatura com JWKS sintetico, audiencia/issuer/tenant,
expiracao, escopo delegado, clientes, API sem token, falhas de dependencia,
duas telas, logout local, resposta obsoleta, 401, popup e erros Teams,
guardas de configuracao, schema e conteudo do ZIP. Nao ha linter configurado.

Teste real esperado, apos configurar seu ambiente:

1. Navegador: tela de login, popup oficial Microsoft, consentimento/MFA
   quando exigidos, perfil confirmado pela API.
2. Teams web, desktop e mobile: SSO usando a conta do host; se houver
   interacao necessaria, use **Entrar com Microsoft**. Falhas persistentes
   de consentimento/MFA podem exigir acao do administrador ou nova entrada
   no proprio Teams; nao ha fallback de senha, Graph ou NAA.
3. Ambos: **Sair do aplicativo** volta ao login; recarregar a mesma aba
   nao entra automaticamente. Clicar em entrar permite nova autenticacao.

| Sintoma | Verificacao |
| --- | --- |
| `SSO_CONFIG_LOAD_FAILED` | Arquivo local, GUIDs, origem HTTPS exata e ausencia de campos extras. |
| `AUTH_ORIGIN` | Abra a origem configurada, nao `localhost` ou outro dominio. |
| `AUTH_TEAMS_INIT` / `AUTH_TEAMS_TIMEOUT` | Reabra no Teams; confira carregamento do SDK, CSP e rede do host. |
| `AUTH_INTERACTION` / `AUTH_TEAMS_TOKEN` | Consentimento, clientes preautorizados, tenant da conta, scope e `webApplicationInfo`. |
| `AUTH_POPUP` | Permita popups; conclua entrada/consentimento/MFA sem fechar a janela. |
| `AUTH_BACKEND_401` | Token v2, audiencia GUID da API, tenant, escopo e relogio do servidor. O Teams pode devolver o mesmo token em cache na segunda tentativa. |
| HTTP 503 | A API nao conseguiu validar a identidade; confira acesso a `login.microsoftonline.com`/JWKS. Nao aceite token sem assinatura. |
| `AUTH_STORAGE` / `AUTH_CLEAR` | Permita armazenamento da sessao; se a limpeza falhar, feche a aba. |
| `PACKAGE_FAILED` | Placeholders, nome do responsavel (1-32 caracteres), caminhos/permissoes ou ZIP ja existente. |

A CSP permite os hosts Teams documentados e o Entra para autenticacao.
A pagina `/auth/callback.html` e uma bridge MSAL separada, com
`frame-ancestors 'self'`, sem COOP. Nao configure o proxy para adicionar
COOP nessa pagina nem `X-Frame-Options: DENY/SAMEORIGIN` na aba principal.
Nao habilite logs HTTP que gravem `Authorization`, codigos OAuth ou tokens.

**Limite das evidencias:** testes locais usam mocks dos SDKs e chaves
sinteticas; nao comprovam login real, politicas corporativas, comportamento
de popup ou compatibilidade de todos os clientes Teams. Execute a lista
manual acima no tenant escolhido antes de distribuir.

## Referencias e direitos

- [Visao geral do SSO em abas](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-overview)
- [Registro Entra e clientes Teams autorizados](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-register-aad)
- [TeamsJS: obter e validar token](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/authentication/tab-sso-code)
- [MSAL Browser v5: redirect bridge](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/redirect-bridge)
- [CSP e requisitos de abas](https://learn.microsoft.com/en-us/microsoftteams/platform/tabs/how-to/tab-requirements)
- [Schema oficial do manifesto 1.23](https://developer.microsoft.com/json-schemas/teams/v1.23/MicrosoftTeams.schema.json),
  obtido em 30/09/2026, preservado em `scripts\schemas\MicrosoftTeams.schema.json`
  para validacao offline; artefato de terceiros da Microsoft, nao autoria deste projeto.

Bibliotecas e schema de terceiros conservam seus direitos e termos
originais. A licenca de publicacao do codigo novo ainda **nao foi escolhida**;
este projeto nao concede uma licenca propria por inferencia. Revise
licenciamento e atribuicoes antes de publicar um repositorio publico.
