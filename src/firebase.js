// ==================== Firebase 연결 ====================
// Claude 미리보기 안에서만 동작하던 window.storage API를,
// 실제 배포 환경에서도 동작하는 Firebase Firestore로 대체한 모듈입니다.
//
// 사용 전 준비물: .env 파일에 Firebase 콘솔에서 받은 설정값을 채워넣어야 해요.
// (.env.example 파일을 참고하세요)

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// 낱말은 각각 하나의 문서로 저장해요 (컬렉션: words).
// Firestore 문서 하나는 최대 1MB까지만 저장할 수 있어서,
// 이미지 1장 + 음성 2개를 한 낱말에 다 넣어도 넘지 않도록
// App.jsx의 MAX_IMAGE_BYTES / MAX_AUDIO_BYTES 값을 줄여뒀어요.
const WORDS_COLLECTION = 'words';
// 오늘의 낱말처럼 앱 전체에서 하나만 있는 값은 meta 컬렉션에 저장해요.
const META_COLLECTION = 'meta';

export async function dbGetWords() {
  const snap = await getDocs(collection(db, WORDS_COLLECTION));
  return snap.docs.map((d) => d.data());
}

export async function dbSaveWord(word) {
  await setDoc(doc(db, WORDS_COLLECTION, word.id), word);
}

export async function dbDeleteWord(id) {
  await deleteDoc(doc(db, WORDS_COLLECTION, id));
}

export async function dbGetToday() {
  const snap = await getDoc(doc(db, META_COLLECTION, 'today'));
  return snap.exists() ? snap.data() : null;
}

export async function dbSetToday(value) {
  await setDoc(doc(db, META_COLLECTION, 'today'), value);
}
