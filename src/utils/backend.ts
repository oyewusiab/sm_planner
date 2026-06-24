import { isFirebaseConfigured, db } from "./firebase";
import { collection, getDocs, doc, setDoc } from "firebase/firestore";
import { Hymn } from "../types";

export function getGsConfig() {
  // Returns empty object since we are migrating away from Apps Script
  return { base_url: "", api_key: "" };
}

export function backendEnabled() {
  return isFirebaseConfigured();
}

export async function pingBackend() {
  if (!backendEnabled()) return null;
  try {
    // Attempt to read from a dummy settings doc to verify Firestore access
    await getDocs(collection(db, "unit_settings"));
    return { ok: true, data: { message: "pong" } };
  } catch (err: any) {
    console.error("Firestore ping failed:", err);
    throw new Error("Unable to connect to Firebase database.");
  }
}

// Static LDS Hymns list used for bootstrapping the hymns collection
const ldsHymnsList: Omit<Hymn, "hymn_id">[] = [
  { number: 1, title: "The Morning Breaks", theme: "Restoration" },
  { number: 2, title: "The Spirit of God", theme: "Restoration" },
  { number: 3, title: "Now Let Us Rejoice", theme: "Restoration" },
  { number: 4, title: "Truth Eternal", theme: "Restoration" },
  { number: 5, title: "High on the Mountain Top", theme: "Restoration" },
  { number: 6, title: "Redeemer of Israel", theme: "Savior" },
  { number: 7, title: "Israel, Israel, God Is Calling", theme: "Restoration" },
  { number: 8, title: "Awake and Arise", theme: "Restoration" },
  { number: 9, title: "Come, Rejoice", theme: "Restoration" },
  { number: 10, title: "Come, Sing to the Lord", theme: "Praise" },
  { number: 19, title: "We Thank Thee, O God, for a Prophet", theme: "Prophets" },
  { number: 169, title: "As Now We Take the Sacrament", theme: "Sacrament" },
  { number: 170, title: "God, Our Father, Hear Us Pray", theme: "Sacrament" },
  { number: 171, title: "With Humble Heart", theme: "Sacrament" },
  { number: 172, title: "In Humility, Our Savior", theme: "Sacrament" },
  { number: 173, title: "While of These Emblems We Partake", theme: "Sacrament" },
  { number: 174, title: "While of These Emblems We Partake", theme: "Sacrament" },
  { number: 175, title: "O God, the Eternal Father", theme: "Sacrament" },
  { number: 176, title: "Tis Sweet to Sing the Matchless Love", theme: "Sacrament" },
  { number: 177, title: "Tis Sweet to Sing the Matchless Love", theme: "Sacrament" },
  { number: 178, title: "O Lord of Hosanna", theme: "Sacrament" },
  { number: 179, title: "Again, Our Dear Redeeming Lord", theme: "Sacrament" },
  { number: 180, title: "Father in Heaven, We Do Believe", theme: "Sacrament" },
  { number: 181, title: "Jesus of Nazareth, Savior and King", theme: "Sacrament" },
  { number: 182, title: "We'll Sing All Hail to Jesus' Name", theme: "Sacrament" },
  { number: 183, title: "In Remembrance of Thy Suffering", theme: "Sacrament" },
  { number: 184, title: "Upon the Cross of Calvary", theme: "Sacrament" },
  { number: 185, title: "Reverently and Meekly Now", theme: "Sacrament" },
  { number: 186, title: "Again We Meet around the Board", theme: "Sacrament" },
  { number: 187, title: "God Loved Us, So He Sent His Son", theme: "Sacrament" },
  { number: 188, title: "Thy Will, O Lord, Be Done", theme: "Sacrament" },
  { number: 189, title: "O Thou, Before the World Began", theme: "Sacrament" },
  { number: 190, title: "In Memory of the Crucified", theme: "Sacrament" },
  { number: 191, title: "Behold the Great Redeemer Die", theme: "Sacrament" },
  { number: 192, title: "He Died! The Great Redeemer Died", theme: "Savior" },
  { number: 193, title: "I Stand All Amazed", theme: "Sacrament" },
  { number: 194, title: "There Is a Green Hill Far Away", theme: "Sacrament" },
  { number: 195, title: "How Great the Wisdom and the Love", theme: "Sacrament" },
  { number: 196, title: "Jesus, Once of Humble Birth", theme: "Sacrament" },
];

export async function syncMusic(): Promise<any> {
  if (!backendEnabled()) return null;
  try {
    const hymnsSnap = await getDocs(collection(db, "hymns"));
    
    // Bootstrap hymns if the collection is empty
    if (hymnsSnap.empty) {
      console.log("Bootstrapping hymns collection in Firestore...");
      for (const hymn of ldsHymnsList) {
        // Use the hymn number as the document ID
        await setDoc(doc(db, "hymns", String(hymn.number)), hymn);
      }
    }
    return { ok: true, data: "Hymns synced successfully" };
  } catch (err: any) {
    console.error("Hymn sync failed:", err);
    throw new Error("Failed to sync hymns with Firebase.");
  }
}

// Deprecated AppScript sync methods kept as stubs for backward compatibility
export async function exportRemoteDB(): Promise<null> {
  return null;
}

export async function importRemoteDB(dbData: any, mode: string = "merge"): Promise<null> {
  return null;
}

export async function apiPost<T>(body: any): Promise<any> {
  return { ok: false, error: "Apps Script API is deprecated." };
}
