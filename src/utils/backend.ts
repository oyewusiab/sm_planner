export function getGsConfig() {
  const localUrl = localStorage.getItem("custom_gs_base_url") || "";
  const localKey = localStorage.getItem("custom_gs_api_key") || "";
  const base_url = localUrl.trim() || (import.meta.env.VITE_GS_BASE_URL || "").trim();
  const api_key = localKey.trim() || (import.meta.env.VITE_GS_API_KEY || "").trim();
  return { base_url, api_key };
}

if (!getGsConfig().base_url && import.meta.env.PROD) {
  console.warn("VITE_GS_BASE_URL is missing in production environment!");
}

type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  code?: number;
  ts?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function backendEnabled() {
  const { base_url } = getGsConfig();
  return Boolean(base_url);
}

function buildUrl(params: Record<string, string>) {
  const { base_url, api_key } = getGsConfig();
  const url = new URL(base_url);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  if (api_key) url.searchParams.set("key", api_key);
  return url.toString();
}

async function apiGet<T>(params: Record<string, string>): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 25000); // 25s timeout
  try {
    const res = await fetch(buildUrl(params), { signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

export async function apiPost<T>(body: any): Promise<ApiResponse<T>> {
  const { base_url, api_key } = getGsConfig();
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 25000); // 25s timeout
  try {
    const res = await fetch(base_url, {
      method: "POST",
      // Use text/plain to avoid CORS preflight on Apps Script web apps.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(api_key ? { ...body, key: api_key } : body),
      signal: controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

async function withBusyRetry<T>(request: () => Promise<ApiResponse<T>>, attempts = 3): Promise<ApiResponse<T>> {
  let last: ApiResponse<T> | null = null;
  for (let i = 0; i < attempts; i++) {
    const res = await request();
    last = res;
    if (res?.ok || res?.error !== "busy_try_again" || i === attempts - 1) return res;
    await sleep(200 * (i + 1));
  }
  return last || { ok: false, error: "request_failed" };
}

export async function exportRemoteDB(): Promise<{ data: any; db_version?: number } | null> {
  if (!backendEnabled()) return null;
  const res = await withBusyRetry(() => apiGet<any>({ action: "export" }));
  if (!res.ok) throw new Error(res.error || "export_failed");
  return { data: res.data || null, db_version: (res as any).db_version };
}

export async function importRemoteDB(db: any, mode: "merge" | "replace" = "merge"): Promise<{ data: any; db_version?: number } | null> {
  if (!backendEnabled()) return null;
  const res = await withBusyRetry(() => apiPost<any>({ action: "import", mode, db }));
  if (!res.ok) throw new Error(res.error || "import_failed");
  return { data: res.data || null, db_version: (res as any).db_version };
}

export async function pingBackend() {
  if (!backendEnabled()) return null;
  const res = await withBusyRetry(() => apiGet<any>({ action: "ping" }));
  if (!res.ok) throw new Error(res.error || "ping_failed");
  return res.data || null;
}

export async function syncMusic() {
  if (!backendEnabled()) return null;
  const res = await withBusyRetry(() => apiGet<any>({ action: "syncHymns" }));
  if (!res.ok) throw new Error(res.error || "sync_failed");
  return res.data || null;
}
