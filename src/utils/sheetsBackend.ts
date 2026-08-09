/**
 * Google Apps Script (Google Sheets) Backend Client
 */

const DEFAULT_GAS_URL = "https://script.google.com/macros/s/AKfycby9YC2DAtKdAv20l5GB79pu6_O81ExqrExpDEWmNpMeX4nQzIPIN5oSumIcY9IVig_vBg/exec";
const GAS_URL_LOCAL_KEY = "sac_meeting_gas_web_app_url_v1";

export function getGasWebAppUrl(): string {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem(GAS_URL_LOCAL_KEY);
    if (saved && saved.trim().startsWith("http")) {
      return saved.trim();
    }
  }
  const envUrl = import.meta.env.VITE_GAS_WEB_APP_URL;
  if (envUrl && envUrl.trim().startsWith("http")) {
    return envUrl.trim();
  }
  return DEFAULT_GAS_URL;
}

export function setGasWebAppUrl(url: string) {
  if (typeof window !== "undefined") {
    if (url && url.trim().startsWith("http")) {
      localStorage.setItem(GAS_URL_LOCAL_KEY, url.trim());
    } else {
      localStorage.removeItem(GAS_URL_LOCAL_KEY);
    }
  }
}

export function isGasConfigured(): boolean {
  return !!getGasWebAppUrl();
}

export async function pullAllFromSheets(): Promise<{ db: any; metadata: any } | null> {
  const url = getGasWebAppUrl();
  if (!url) return null;
  
  try {
    const response = await fetch(`${url}?action=export`, {
      method: "GET",
      mode: "cors",
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    const data = await response.json();
    
    // Support both export and pullAll response shapes
    const dbPayload = data.data || data.db;
    if ((data.ok || data.status === "success") && dbPayload) {
      const ts = data.ts || data.metadata?.last_updated || new Date().toISOString();
      return { 
        db: dbPayload, 
        metadata: { 
          last_updated: ts, 
          db_version: data.db_version || data.metadata?.db_version || 1 
        } 
      };
    }
    return null;
  } catch (err) {
    console.warn("[Google Sheets Sync] Pull failed:", err);
    return null;
  }
}

export async function pushAllToSheets(dbData: any): Promise<{ success: boolean; metadata?: any }> {
  const url = getGasWebAppUrl();
  if (!url) return { success: false };
  
  try {
    const response = await fetch(url, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // text/plain avoids CORS preflight OPTIONS in Apps Script
      body: JSON.stringify({ action: "import", db: dbData, mode: "merge" })
    });
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    const data = await response.json();
    if (data.ok || data.status === "success") {
      const ts = data.ts || data.metadata?.last_updated || new Date().toISOString();
      return { 
        success: true, 
        metadata: { 
          last_updated: ts, 
          db_version: data.db_version || data.metadata?.db_version || 1 
        } 
      };
    }
    return { success: false };
  } catch (err) {
    console.warn("[Google Sheets Sync] Push failed:", err);
    return { success: false };
  }
}

export async function getSheetsMetadata(): Promise<any | null> {
  const url = getGasWebAppUrl();
  if (!url) return null;
  
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(`${url}?action=ping`, {
        method: "GET",
        mode: "cors",
        redirect: "follow",
        headers: { "Accept": "application/json" }
      });
      if (!response.ok) {
        if (attempt < 2) continue;
        return null;
      }
      const data = await response.json();
      if (data.ok || data.status === "success") {
        const dbVer = data.data?.db_version || data.db_version || data.metadata?.db_version || 1;
        const ts = data.ts || data.metadata?.last_updated || new Date().toISOString();
        return {
          last_updated: `${dbVer}_${ts}`,
          db_version: dbVer
        };
      }
    } catch (err) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
    }
  }
  return null;
}
