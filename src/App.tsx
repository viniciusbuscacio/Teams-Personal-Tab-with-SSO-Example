import { useEffect, useRef, useState } from "react";
import type { ProtectedResult } from "../shared/sso-config";
import { AuthFailure, loadProfile, type TokenSource } from "./auth-client";
import { prepareAuthentication } from "./authentication";
import { initializeTeams } from "./teams";

const logoutKey = "personal-tab.explicit-sign-in";
function explicitSignInRequired(): boolean {
  try { return sessionStorage.getItem(logoutKey) === "true"; }
  catch { throw new AuthFailure("AUTH_STORAGE"); }
}
function requireExplicitSignIn(required: boolean) {
  try {
    if (required) sessionStorage.setItem(logoutKey, "true");
    else sessionStorage.removeItem(logoutKey);
  } catch { throw new AuthFailure("AUTH_STORAGE"); }
}
function message(failure: unknown): string {
  return failure instanceof AuthFailure ? failure.message :
    "Sign-in is unavailable. Check your connection, HTTPS, and configuration, then try again.";
}

export function App({ embedded }: { embedded: boolean }) {
  const [source, setSource] = useState<TokenSource>();
  const [result, setResult] = useState<ProtectedResult>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const operation = useRef<AbortController | null>(null);
  const locked = useRef(true);

  useEffect(() => {
    const controller = new AbortController();
    operation.current = controller;
    locked.current = true;
    setSource(undefined);
    setResult(undefined);
    setError("");
    setBusy(true);
    let auth: TokenSource | undefined;
    void (async () => {
      await initializeTeams(embedded);
      if (controller.signal.aborted) return;
      auth = await prepareAuthentication(embedded);
      if (controller.signal.aborted) return;
      setSource(auth);
      if (embedded && !explicitSignInRequired()) {
        const profile = await loadProfile(auth, controller.signal);
        if (!controller.signal.aborted) setResult(profile);
      }
    })().catch(async failure => {
      if (controller.signal.aborted) return;
      setResult(undefined);
      setError(message(failure));
      try { await auth?.clear(); }
      catch { if (!controller.signal.aborted) setError(new AuthFailure("AUTH_CLEAR").message); }
    }).finally(() => {
      if (!controller.signal.aborted) { locked.current = false; setBusy(false); }
    });
    return () => { controller.abort(); operation.current?.abort(); };
  }, [embedded, attempt]);

  async function signIn() {
    if (!source || locked.current) return;
    const controller = new AbortController();
    operation.current = controller;
    locked.current = true;
    setBusy(true);
    setResult(undefined);
    setError("");
    try {
      const token = await source.signIn();
      const profile = await loadProfile(source, controller.signal, token);
      if (!controller.signal.aborted) {
        requireExplicitSignIn(false);
        setResult(profile);
      }
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(message(failure));
      try { await source.clear(); }
      catch { if (!controller.signal.aborted) setError(new AuthFailure("AUTH_CLEAR").message); }
    } finally {
      if (!controller.signal.aborted) { locked.current = false; setBusy(false); }
    }
  }

  async function signOut() {
    if (!source || locked.current) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    locked.current = true;
    setResult(undefined);
    setError("");
    setBusy(true);
    try { requireExplicitSignIn(true); }
    catch (failure) { setError(message(failure)); }
    try { await source.clear(); }
    catch {
      if (!controller.signal.aborted) setError(new AuthFailure("AUTH_CLEAR").message);
    } finally {
      if (!controller.signal.aborted) { locked.current = false; setBusy(false); }
    }
  }

  return <main className="container py-5">
    <div className="card shadow-sm mx-auto app-card">
      <div className="card-body p-4">
        <p className="text-secondary small mb-2">{embedded ? "Teams personal tab" : "Browser"}</p>
        <h1 className="h4 mb-4">Teams Personal Tab with SSO Example</h1>
        {busy && <p role="status">Connecting...</p>}
        {error && <p className="alert alert-danger" role="alert">{error}</p>}
        {result ? <section aria-label="Authenticated user">
          <h2 className="h5">{result.user.name ?? "Authenticated user"}</h2>
          <p>{result.user.username ?? "Sign-in identifier not provided by Microsoft Entra ID."}</p>
          <p className="text-secondary small">Identity verified by the API using Microsoft Entra ID.</p>
          <button className="btn btn-outline-primary w-100" disabled={busy} onClick={() => void signOut()}>
            Sign out of the app
          </button>
        </section> : <section aria-label="Sign in">
          <h2 className="h5">Welcome</h2>
          <p>{embedded ? "Sign in with the account you use in Teams." :
            "Sign in with your Microsoft work account."}</p>
          {source ? <button className="btn btn-primary w-100" disabled={busy} onClick={() => void signIn()}>
            Sign in with Microsoft
          </button> : !busy && <button className="btn btn-primary w-100" onClick={() => setAttempt(value => value + 1)}>
            Try again
          </button>}
        </section>}
        <p className="small text-secondary mt-4 mb-0">
          Signing out only clears this app's local state. Your Microsoft and Teams sessions remain signed in.
        </p>
      </div>
    </div>
    <footer className="text-center mt-3 small">
      <a href="/support.html" target="_blank" rel="noopener noreferrer">About this example</a>
    </footer>
  </main>;
}
