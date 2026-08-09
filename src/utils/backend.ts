import { isGasConfigured, getGasWebAppUrl, getSheetsMetadata } from "./sheetsBackend";
import { Hymn } from "../types";

export function getGsConfig() {
  return { base_url: getGasWebAppUrl(), api_key: "" };
}

export function backendEnabled() {
  return isGasConfigured();
}

export async function pingBackend() {
  if (!backendEnabled()) return null;
  try {
    const meta = await getSheetsMetadata();
    if (meta) {
      return { ok: true, data: { message: "pong" } };
    }
    console.warn("Google Sheets ping: Backend currently unreachable.");
    throw new Error("Unable to connect to Google Sheets backend.");
  } catch (err: any) {
    console.warn("Google Sheets ping warning:", err?.message || err);
    throw new Error("Unable to connect to Google Sheets backend.");
  }
}

// Static LDS Hymns list used for bootstrapping
export const BUNDLED_HYMNS: Hymn[] = [
  { hymn_id: "h_1", number: 1, title: "The Morning Breaks", theme: "Restoration" },
  { hymn_id: "h_2", number: 2, title: "The Spirit of God", theme: "Restoration" },
  { hymn_id: "h_3", number: 3, title: "Now Let Us Rejoice", theme: "Restoration" },
  { hymn_id: "h_4", number: 4, title: "Truth Eternal", theme: "Restoration" },
  { hymn_id: "h_5", number: 5, title: "High on the Mountain Top", theme: "Restoration" },
  { hymn_id: "h_6", number: 6, title: "Redeemer of Israel", theme: "Savior" },
  { hymn_id: "h_7", number: 7, title: "Israel, Israel, God Is Calling", theme: "Restoration" },
  { hymn_id: "h_8", number: 8, title: "Awake and Arise", theme: "Restoration" },
  { hymn_id: "h_9", number: 9, title: "Come, Rejoice", theme: "Restoration" },
  { hymn_id: "h_10", number: 10, title: "Come, Sing to the Lord", theme: "Praise" },
  { hymn_id: "h_19", number: 19, title: "We Thank Thee, O God, for a Prophet", theme: "Prophets" },
  { hymn_id: "h_169", number: 169, title: "As Now We Take the Sacrament", theme: "Sacrament" },
  { hymn_id: "h_170", number: 170, title: "God, Our Father, Hear Us Pray", theme: "Sacrament" },
  { hymn_id: "h_171", number: 171, title: "With Humble Heart", theme: "Sacrament" },
  { hymn_id: "h_172", number: 172, title: "In Humility, Our Savior", theme: "Sacrament" },
  { hymn_id: "h_173", number: 173, title: "While of These Emblems We Partake", theme: "Sacrament" },
  { hymn_id: "h_174", number: 174, title: "While of These Emblems We Partake", theme: "Sacrament" },
  { hymn_id: "h_175", number: 175, title: "O God, the Eternal Father", theme: "Sacrament" },
  { hymn_id: "h_176", number: 176, title: "Tis Sweet to Sing the Matchless Love", theme: "Sacrament" },
  { hymn_id: "h_177", number: 177, title: "Tis Sweet to Sing the Matchless Love", theme: "Sacrament" },
  { hymn_id: "h_178", number: 178, title: "O Lord of Hosanna", theme: "Sacrament" },
  { hymn_id: "h_179", number: 179, title: "Again, Our Dear Redeeming Lord", theme: "Sacrament" },
  { hymn_id: "h_180", number: 180, title: "Father in Heaven, We Do Believe", theme: "Sacrament" },
  { hymn_id: "h_181", number: 181, title: "Jesus of Nazareth, Savior and King", theme: "Sacrament" },
  { hymn_id: "h_182", number: 182, title: "We'll Sing All Hail to Jesus' Name", theme: "Sacrament" },
  { hymn_id: "h_183", number: 183, title: "In Remembrance of Thy Suffering", theme: "Sacrament" },
  { hymn_id: "h_184", number: 184, title: "Upon the Cross of Calvary", theme: "Sacrament" },
  { hymn_id: "h_185", number: 185, title: "Reverently and Meekly Now", theme: "Sacrament" },
  { hymn_id: "h_186", number: 186, title: "Again We Meet around the Board", theme: "Sacrament" },
  { hymn_id: "h_187", number: 187, title: "God Loved Us, So He Sent His Son", theme: "Sacrament" },
  { hymn_id: "h_188", number: 188, title: "Thy Will, O Lord, Be Done", theme: "Sacrament" },
  { hymn_id: "h_189", number: 189, title: "O Thou, Before the World Began", theme: "Sacrament" },
  { hymn_id: "h_190", number: 190, title: "In Memory of the Crucified", theme: "Sacrament" },
  { hymn_id: "h_191", number: 191, title: "Behold the Great Redeemer Die", theme: "Sacrament" },
  { hymn_id: "h_192", number: 192, title: "He Died! The Great Redeemer Died", theme: "Savior" },
  { hymn_id: "h_193", number: 193, title: "I Stand All Amazed", theme: "Sacrament" },
  { hymn_id: "h_194", number: 194, title: "There Is a Green Hill Far Away", theme: "Sacrament" },
  { hymn_id: "h_195", number: 195, title: "How Great the Wisdom and the Love", theme: "Sacrament" },
  { hymn_id: "h_196", number: 196, title: "Jesus, Once of Humble Birth", theme: "Sacrament" },
];

export async function syncMusic(): Promise<any> {
  return { ok: true, data: "Hymns loaded from local bundle" };
}

export async function exportRemoteDB(): Promise<null> {
  return null;
}

export async function importRemoteDB(dbData: any, mode: string = "merge"): Promise<null> {
  return null;
}

export async function apiPost<T>(body: any): Promise<any> {
  return { ok: false, error: "Legacy API endpoint is deprecated." };
}
