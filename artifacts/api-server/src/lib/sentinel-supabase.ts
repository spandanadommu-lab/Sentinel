import type { Request, Response } from "express";
import { updateDataSourceStatus } from "./sentinel-demo";

export type SentinelRole = "ADMIN" | "OPERATOR" | "VIEWER";
export type SentinelContext =
  | { kind: "demo"; role: "ADMIN"; userId: "demo-operator" }
  | { kind: "supabase"; role: SentinelRole; userId: string; accessToken: string };

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, "");
// Keep privileged configuration server-side; every data request still carries the
// user's access token so Postgres RLS evaluates the authenticated user's role.
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export async function resolveSentinelContext(
  req: Request,
  res: Response,
): Promise<SentinelContext | null> {
  const authorization = req.header("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (token === "sentinel-demo") {
    return { kind: "demo", role: "ADMIN", userId: "demo-operator" };
  }

  if (!isSupabaseConfigured) {
    return { kind: "demo", role: "ADMIN", userId: "demo-operator" };
  }

  if (!token) {
    res.status(401).json({ error: "Sign in or explicitly enter the simulated demo environment." });
    return null;
  }

  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseKey!, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!userResponse.ok) {
      res.status(401).json({ error: "Your session is invalid or expired. Sign in again." });
      return null;
    }
    const user = (await userResponse.json()) as { id?: string };
    if (!user.id) {
      res.status(401).json({ error: "The identity provider returned no user ID." });
      return null;
    }

    const profileResponse = await fetch(
      `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`,
      { headers: { apikey: supabaseKey!, authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) },
    );
    if (!profileResponse.ok) {
      updateDataSourceStatus("supabase", "ERROR", "Could not verify the authenticated user's SENTINEL role.", `HTTP ${profileResponse.status}`);
      res.status(503).json({ error: "Could not verify your SENTINEL role. Check the Supabase schema and retry." });
      return null;
    }
    const profiles = (await profileResponse.json()) as Array<{ role?: string }>;
    const role = profiles[0]?.role;
    if (role !== "ADMIN" && role !== "OPERATOR" && role !== "VIEWER") {
      updateDataSourceStatus("supabase", "ERROR", "The account has no valid SENTINEL role.", "Missing or invalid profile role");
      res.status(403).json({ error: "No valid SENTINEL role is assigned to this account." });
      return null;
    }
    updateDataSourceStatus("supabase", "LIVE", "Authenticated Supabase access and SENTINEL role verified.");
    return { kind: "supabase", role, userId: user.id, accessToken: token };
  } catch (error) {
    req.log.warn({ err: error }, "Supabase identity check unavailable");
    updateDataSourceStatus("supabase", "ERROR", "Supabase identity verification failed; live reads and writes are unavailable.", error instanceof Error ? error.message : String(error));
    res.status(503).json({ error: "Supabase is unavailable. Retry when the connection is restored." });
    return null;
  }
}

export function requireOperationalRole(
  context: SentinelContext,
  res: Response,
): boolean {
  if (context.role === "ADMIN" || context.role === "OPERATOR") return true;
  res.status(403).json({ error: "Your VIEWER role is read-only." });
  return false;
}

function snakeToCamel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(snakeToCamel);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replace(/_([a-z])/g, (_match, char: string) => char.toUpperCase()),
      snakeToCamel(item),
    ]),
  );
}

function camelToSnake(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`),
      item,
    ]),
  );
}

async function supabaseRequest(
  context: Extract<SentinelContext, { kind: "supabase" }>,
  table: string,
  query: string,
  method = "GET",
  body?: unknown,
): Promise<unknown> {
  const headers: Record<string, string> = {
    apikey: supabaseKey!,
    authorization: `Bearer ${context.accessToken}`,
    accept: "application/json",
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    headers.prefer = "return=representation";
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}${query}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase ${method} ${table} failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? snakeToCamel(JSON.parse(text)) : null;
}

export async function readSupabaseTable<T>(
  context: SentinelContext,
  table: string,
  filters = "select=*",
): Promise<T[]> {
  if (context.kind === "demo") return [];
  const query = `?${filters}`;
  const result = await supabaseRequest(context, table, query);
  return Array.isArray(result) ? (result as T[]) : [];
}

export async function insertSupabaseRow<T>(
  context: SentinelContext,
  table: string,
  values: object,
): Promise<T> {
  if (context.kind !== "supabase") throw new Error("Supabase write requested in demo mode.");
  const result = await supabaseRequest(context, table, "?select=*", "POST", camelToSnake(values));
  if (!Array.isArray(result) || !result[0]) throw new Error(`Supabase did not return the inserted ${table} row.`);
  return result[0] as T;
}

export async function updateSupabaseRow<T>(
  context: SentinelContext,
  table: string,
  id: string,
  values: object,
): Promise<T | null> {
  if (context.kind !== "supabase") throw new Error("Supabase write requested in demo mode.");
  const result = await supabaseRequest(
    context,
    table,
    `?id=eq.${encodeURIComponent(id)}&select=*`,
    "PATCH",
    camelToSnake(values),
  );
  if (!Array.isArray(result)) return null;
  return (result[0] as T | undefined) ?? null;
}

export async function deleteSupabaseRows(
  context: SentinelContext,
  table: string,
  filters: string,
): Promise<void> {
  if (context.kind !== "supabase") throw new Error("Supabase delete requested in demo mode.");
  await supabaseRequest(context, table, `?${filters}`, "DELETE");
}

export function supabaseTableUrl(path: string): string {
  if (!supabaseUrl) throw new Error("Supabase is not configured.");
  return `${supabaseUrl}${path}`;
}

export function supabasePublicKey(): string | undefined {
  return supabaseKey;
}
