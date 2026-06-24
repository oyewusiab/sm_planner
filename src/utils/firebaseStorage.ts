import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "./firebase";

/**
 * Converts a base64 DataURL (e.g. data:image/png;base64,...) to a Blob
 */
export function base64ToBlob(base64DataUrl: string): Blob {
  const parts = base64DataUrl.split(";base64,");
  const contentType = parts[0].split(":")[1] || "image/png";
  const raw = window.atob(parts[1]);
  const rawLength = raw.length;
  const uInt8Array = new Uint8Array(rawLength);

  for (let i = 0; i < rawLength; ++i) {
    uInt8Array[i] = raw.charCodeAt(i);
  }

  return new Blob([uInt8Array], { type: contentType });
}

/**
 * Uploads a base64 signature image to Firebase Storage and returns its public URL
 */
export async function uploadSignature(userId: string, base64DataUrl: string): Promise<string> {
  if (!base64DataUrl.startsWith("data:")) {
    // If it's already a URL (e.g. from Firebase Storage), just return it
    return base64DataUrl;
  }

  try {
    const blob = base64ToBlob(base64DataUrl);
    const storageRef = ref(storage, `signatures/${userId}.png`);
    
    // Upload bytes
    await uploadBytes(storageRef, blob, {
      contentType: blob.type,
    });

    // Get public download URL
    const downloadUrl = await getDownloadURL(storageRef);
    return downloadUrl;
  } catch (error) {
    console.error("Firebase Storage signature upload failed:", error);
    throw new Error("Failed to upload signature to cloud storage.");
  }
}
