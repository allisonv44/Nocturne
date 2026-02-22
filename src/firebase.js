import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';

// From Firebase Console → Project Settings → Your apps → SDK setup & configuration
const firebaseConfig = {
  apiKey: "AIzaSyAIV7X0d8dn4-j5UVDRHUv4GxR00Pr0gUE",
  authDomain: "nocturne-87c33.firebaseapp.com",
  projectId: "nocturne-87c33",
  storageBucket: "nocturne-87c33.firebasestorage.app",
  messagingSenderId: "860334917357",
  appId: "1:860334917357:web:4839d70107a18215abaee4",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = initializeFirestore(app, {}, 'nocturne');
