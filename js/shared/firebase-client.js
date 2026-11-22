import { initializeApp, getApps } from 'firebase/app';

const firebaseConfig = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY || '').trim(),
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim(),
  storageBucket: (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
  messagingSenderId: (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
  appId: (import.meta.env.VITE_FIREBASE_APP_ID || '').trim(),
};

let firebaseAppInstance = null;

/**
 * Inicializa e devolve a instância singleton da Firebase Web App configurada via .env.
 */
export function getFirebaseApp() {
  if (firebaseAppInstance) return firebaseAppInstance;

  if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
    return null;
  }

  const existing = getApps();
  firebaseAppInstance = existing.length > 0 ? existing[0] : initializeApp(firebaseConfig);
  return firebaseAppInstance;
}
