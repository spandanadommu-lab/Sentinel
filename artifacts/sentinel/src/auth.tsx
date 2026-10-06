import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { setAuthTokenGetter } from "@workspace/api-client-react";

type AuthMode = "demo" | "live" | null;

interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user: { id: string; email?: string };
}

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  mode: AuthMode;
  role: string;
  email: string;
  error: string;
  notice: string;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  continueDemo: () => void;
  signOut: () => Promise<void>;
  switchToDemo: () => Promise<void>;
  clearMessages: () => void;
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, "");
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const configured = Boolean(supabaseUrl && publishableKey);
const SESSION_KEY = "sentinel_supabase_session";
const DEMO_KEY = "sentinel_demo_mode";

setAuthTokenGetter(() => {
  if (typeof window === "undefined") return null;
  if (sessionStorage.getItem(DEMO_KEY) === "true") return "sentinel-demo";
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as SupabaseSession | null;
    return session?.access_token ?? null;
  } catch {
    return null;
  }
});

const AuthContext = createContext<AuthContextValue | null>(null);

async function responseMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => ({})) as {
    msg?: string;
    message?: string;
    error_description?: string;
    error?: string;
  };
  return body.msg || body.message || body.error_description || body.error || `Request failed (${response.status}).`;
}

async function readProfile(session: SupabaseSession): Promise<string> {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(session.user.id)}&select=role`,
    {
      headers: {
        apikey: publishableKey!,
        authorization: `Bearer ${session.access_token}`,
      },
    },
  );
  if (!response.ok) {
    throw new Error("Could not verify your SENTINEL role. Run the supplied Supabase schema, then sign in again.");
  }
  const profiles = await response.json() as Array<{ role?: string }>;
  const role = profiles[0]?.role;
  if (!role || !["ADMIN", "OPERATOR", "VIEWER"].includes(role)) {
    throw new Error("This account has no SENTINEL role profile. Ask an administrator to assign one.");
  }
  return role;
}

function normalizeSession(session: SupabaseSession): SupabaseSession {
  const expiresAt = session.expires_at ?? (session.expires_in ? Math.floor(Date.now() / 1000) + session.expires_in : undefined);
  return { ...session, ...(expiresAt ? { expires_at: expiresAt } : {}) };
}

async function refreshSession(session: SupabaseSession): Promise<SupabaseSession> {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: publishableKey!, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!response.ok) throw new Error("Your session expired. Sign in again.");
  return normalizeSession(await response.json() as SupabaseSession);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AuthMode>(() => {
    if (typeof window === "undefined") return null;
    if (sessionStorage.getItem(DEMO_KEY) === "true") return "demo";
    if (sessionStorage.getItem(SESSION_KEY)) return "live";
    return configured ? null : "demo";
  });
  const [loading, setLoading] = useState(() => typeof window !== "undefined" && Boolean(sessionStorage.getItem(SESSION_KEY)));
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        let session = normalizeSession(JSON.parse(raw) as SupabaseSession);
        if (session.expires_at && session.expires_at < Math.floor(Date.now() / 1000) + 60) {
          session = await refreshSession(session);
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        }
        const currentRole = await readProfile(session);
        if (!cancelled) {
          setEmail(session.user.email ?? "");
          setRole(currentRole);
          setMode("live");
        }
      } catch (issue) {
        if (!cancelled) {
          sessionStorage.removeItem(SESSION_KEY);
          setMode(sessionStorage.getItem(DEMO_KEY) === "true" ? "demo" : null);
          setError(issue instanceof Error ? issue.message : "Could not restore the session.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const acceptSession = async (received: SupabaseSession) => {
    const session = normalizeSession(received);
    const currentRole = await readProfile(session);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    sessionStorage.removeItem(DEMO_KEY);
    setEmail(session.user.email ?? "");
    setRole(currentRole);
    setMode("live");
    setError("");
    setNotice("");
  };

  const signIn = async (userEmail: string, password: string) => {
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: publishableKey!, "content-type": "application/json" },
        body: JSON.stringify({ email: userEmail.trim(), password }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      await acceptSession(await response.json() as SupabaseSession);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Sign-in failed.");
      throw issue;
    }
  };

  const signUp = async (userEmail: string, password: string) => {
    setError("");
    setNotice("");
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/signup`, {
        method: "POST",
        headers: { apikey: publishableKey!, "content-type": "application/json" },
        body: JSON.stringify({ email: userEmail.trim(), password }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = await response.json() as SupabaseSession & { access_token?: string; user?: { id: string; email?: string } };
      if (result.access_token && result.user) {
        await acceptSession(result as SupabaseSession);
      } else {
        setNotice("Account created. Check your email for verification, then sign in. New accounts start with the read-only VIEWER role.");
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Account creation failed.");
      throw issue;
    }
  };

  const continueDemo = () => {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.setItem(DEMO_KEY, "true");
    setMode("demo");
    setEmail("");
    setRole("DEMO OPERATOR");
    setError("");
    setNotice("");
  };

  const signOut = async () => {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      try {
        const session = JSON.parse(raw) as SupabaseSession;
        await fetch(`${supabaseUrl}/auth/v1/logout`, {
          method: "POST",
          headers: { apikey: publishableKey!, authorization: `Bearer ${session.access_token}` },
        });
      } catch {
        // Local state is cleared even if the auth service cannot be reached.
      }
    }
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(DEMO_KEY);
    setMode(configured ? null : "demo");
    setEmail("");
    setRole("");
    setError("");
    setNotice("");
  };

  const switchToDemo = async () => {
    await signOut();
    sessionStorage.setItem(DEMO_KEY, "true");
    setMode("demo");
    setRole("DEMO OPERATOR");
  };

  const value = useMemo<AuthContextValue>(() => ({
    configured,
    loading,
    mode,
    role: mode === "demo" ? "DEMO OPERATOR" : role,
    email,
    error,
    notice,
    signIn,
    signUp,
    continueDemo,
    signOut,
    switchToDemo,
    clearMessages: () => { setError(""); setNotice(""); },
  }), [loading, mode, role, email, error, notice]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useSentinelAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useSentinelAuth must be used within AuthProvider.");
  return context;
}
