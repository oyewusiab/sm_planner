const BASE_URL = (import.meta.env.VITE_GS_BASE_URL || "").trim();
const API_KEY = (import.meta.env.VITE_GS_API_KEY || "").trim();

if (!BASE_URL && import.meta.env.PROD) {
  console.warn("VITE_GS_BASE_URL is missing in production environment!");
}

type ApiResponse<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  code?: number;
  ts?: string;
};

export function backendEnabled() {
  return Boolean(BASE_URL);
}

function buildUrl(params: Record<string, string>) {
  const url = new URL(BASE_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  if (API_KEY) url.searchParams.set("key", API_KEY);
  return url.toString();
}

async function apiGet<T>(params: Record<string, string>): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 10000); // 10s timeout
  try {
    const res = await fetch(buildUrl(params), { signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

async function apiPost<T>(body: any): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 10000); // 10s timeout
  try {
    const res = await fetch(BASE_URL, {
      method: "POST",
      // Use text/plain to avoid CORS preflight on Apps Script web apps.
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(API_KEY ? { ...body, key: API_KEY } : body),
      signal: controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(id);
  }
}

export async function exportRemoteDB(): Promise<any | null> {
  if (!backendEnabled()) return null;
  const res = await apiGet<any>({ action: "export" });
  if (!res.ok) throw new Error(res.error || "export_failed");
  return res.data || null;
}

export async function importRemoteDB(db: any, mode: "merge" | "replace" = "merge") {
  if (!backendEnabled()) return null;
  const res = await apiPost<any>({ action: "import", mode, db });
  if (!res.ok) throw new Error(res.error || "import_failed");
  return res.data || null;
}

export async function pingBackend() {
  if (!backendEnabled()) return null;
  const res = await apiGet<any>({ action: "ping" });
  if (!res.ok) throw new Error(res.error || "ping_failed");
  return res.data || null;
}
