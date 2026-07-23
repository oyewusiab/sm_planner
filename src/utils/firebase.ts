import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBgBVCNQ061I5cjvq6s4YIY3Bw_oD3mgTE",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "smplanner-30029.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "smplanner-30029",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "smplanner-30029.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "854112722326",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:854112722326:web:2c7da143695245f56691b7",
};

// Check if Firebase has been initialized already
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

export function isFirebaseConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}
