import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId); /* CRITICAL: The app will break without this line */
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Enforce custom parameters to present Google authentication accounts cleanly
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// Enforce Admin Emails
export const ADMIN_EMAILS = [
  'mintjamong99@gmail.com',
  'seminary1991@gmail.com'
];

export function isUserAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.toLowerCase());
}

// Test Connection on load
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

// --- STRICT STRUCTURED ERROR HANDLERS ---
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
  const rawMsg = error instanceof Error ? error.message : String(error);
  
  // Create user-friendly message
  let userMsg = "데이터베이스 작업 처리 중 오류가 발생했습니다.";
  if (rawMsg.includes("permission-denied") || rawMsg.includes("Missing or insufficient permissions")) {
    userMsg = "동기화 권한이 거부되었습니다. 해당 구글 계정(Admin)으로 로그인하셨는지 확인해 주세요.";
  } else if (rawMsg.includes("invalid-argument")) {
    userMsg = "데이터 규격이 올바르지 않습니다. (스키마 불일치)";
  }
  
  alert(`[데이터 동기화 실패]\n${userMsg}\n\n상세 정보: ${rawMsg}`);

  const errInfo: FirestoreErrorInfo = {
    error: rawMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error Details: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Popup SignIn Strategy (Required in AI Studio Preview environment)
export async function logInWithGoogle() {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    return result.user;
  } catch (error) {
    console.error('Core Google Login Failure:', error);
    throw error;
  }
}

export async function logOutFromFirebase() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('Core Logout Failure:', error);
    throw error;
  }
}
