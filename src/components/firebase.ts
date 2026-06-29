import { initializeApp } from 'firebase/app';
import { 
  getFirestore,
  initializeFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc,
  getDocFromServer,
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

let _app: any;
let _db: any;
let _auth: any;

export function getApp() {
  if (!_app) {
    _app = initializeApp(firebaseConfig);
  }
  return _app;
}

export function getDb() {
  if (!_db) {
    const app = getApp();
    // Use initializeFirestore with experimentalForceLongPolling to bypass some network issues
    try {
      _db = initializeFirestore(app, {
        experimentalForceLongPolling: true,
        experimentalAutoDetectLongPolling: true,
      }, firebaseConfig.firestoreDatabaseId);
    } catch (e) {
      // Fallback to getFirestore if initializeFirestore fails (e.g. if already initialized)
      _db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
    }
  }
  return _db;
}

export function getAuthInstance() {
  if (!_auth) {
    const app = getApp();
    _auth = getAuth(app);
  }
  return _auth;
}



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
      try {
        errorMessage = String(error);
      } catch (e) {
        errorMessage = 'Unknown error object';
      }
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

  const auth = getAuthInstance();
  const errInfo = {
    error: errorMessage || errorCode || 'Unknown Firestore error',
    userId: auth.currentUser?.uid || null,
    operationType,
    path
  };
  
  console.error('Firestore Error:', errInfo.error, 'Op:', errInfo.operationType, 'Path:', errInfo.path);
  throw new Error(`Firestore Error: ${errInfo.error} (${errInfo.operationType} on ${errInfo.path})`);
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
