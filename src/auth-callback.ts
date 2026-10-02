import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";

broadcastResponseToMainFrame().catch(() => {
  document.body.textContent = "Unable to complete authentication. Close this window and try again.";
});
