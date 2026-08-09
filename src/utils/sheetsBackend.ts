/**
 * Google Apps Script (Google Sheets) Backend Client
 */

const GAS_URL_LOCAL_KEY = "sac_meeting_gas_web_app_url_v1";

export function getGasWebAppUrl(): string {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem(GAS_URL_LOCAL_KEY);
    if (saved && saved.trim().startsWith("http")) {
      return saved.trim();
    }
  }
  const envUrl = import.meta.env.VITE_GAS_WEB_APP_URL;
  return (envUrl && envUrl.trim().startsWith("http")) ? envUrl.trim() : "";
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
    const response = await fetch(`${url}?action=pullAll`, {
      method: "GET",
      mode: "cors",
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    const data = await response.json();
    if (data.status === "success" && data.db) {
      return { db: data.db, metadata: data.metadata || {} };
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
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // Using text/plain prevents CORS preflight issues with Google Apps Script
      body: JSON.stringify({ action: "pushAll", data: dbData })
    });
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    const data = await response.json();
    if (data.status === "success") {
      return { success: true, metadata: data.metadata };
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
  
  try {
    const response = await fetch(`${url}?action=getMetadata`, {
      method: "GET",
      mode: "cors",
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.status === "success") {
      return data.metadata || null;
    }
    return null;
  } catch (err) {
    return null;
  }
}
