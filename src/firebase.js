import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// From Firebase Console → Project Settings → Your apps → SDK setup & configuration
const firebaseConfig = {
  apiKey: "REPLACE_WITH_API_KEY",
  authDomain: "nocturne-87c33.firebaseapp.com",
  projectId: "nocturne-87c33",
  storageBucket: "nocturne-87c33.firebasestorage.app",
  messagingSenderId: "REPLACE_WITH_SENDER_ID",
  appId: "REPLACE_WITH_APP_ID",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
