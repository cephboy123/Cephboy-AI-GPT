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
  orderBy 
} from 'firebase/firestore';

// Configuration injected dynamically or hardcoded from firebase-applet-config.json
const firebaseConfig = {
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
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
      emailVerified: null,
      isAnonymous: null,
      tenantId: null,
      providerInfo: []
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
  orderBy 
};
