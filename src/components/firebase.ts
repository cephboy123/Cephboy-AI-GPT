import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy,
  where,
  updateDoc
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';

// Configuration injected dynamically or hardcoded from firebase-applet-config.json
export const firebaseConfig = {
  projectId: "flutter-ai-playground-c9906",
  appId: "1:271345228299:web:828c3c2b107590ded9c50e",
  apiKey: "AIzaSyAJJSHKlzoBSEZBziuLInUEeXmJEchl8Pg",
  authDomain: "flutter-ai-playground-c9906.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-cephboyaigptchat-b4bda7af-1b2e-4dfc-b5c9-e6bd14a01bad",
  storageBucket: "flutter-ai-playground-c9906.firebasestorage.app",
  messagingSenderId: "271345228299"
};

const app = initializeApp(firebaseConfig);

// Critical: Use the custom database ID provided in the configuration
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  let errorMessage = '';
  let errorCode = '';
  
  if (error && typeof error === 'object') {
    errorMessage = (error as any).message || '';
    errorCode = (error as any).code || '';
    if (!errorMessage && !errorCode) {
      errorMessage = JSON.stringify(error);
    }
  } else {
    errorMessage = String(error);
  }

  const errStrLower = `${errorMessage} ${errorCode}`.toLowerCase();
  const isOfflineOrNetwork = 
    errStrLower.includes('offline') || 
    errStrLower.includes('unavailable') || 
    errStrLower.includes('could not reach') || 
    errStrLower.includes('network') ||
    errStrLower.includes('internet');

  if (isOfflineOrNetwork) {
    console.warn(`Firestore Warning (Offline Mode): Operation ${operationType} on path ${path} is queued or deferred. Client is offline.`);
    return;
  }

  const errInfo: FirestoreErrorInfo = {
    error: errorMessage || errorCode || 'Unknown Firestore error',
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy,
  where,
  updateDoc,
  signInAnonymously,
  onAuthStateChanged
};
