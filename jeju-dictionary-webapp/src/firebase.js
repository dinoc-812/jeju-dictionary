// ==================== Firebase 연결 ====================
// Claude 미리보기 안에서만 동작하던 window.storage API를,
// 실제 배포 환경에서도 동작하는 Firebase Firestore로 대체한 모듈입니다.
//
// 사용 전 준비물: .env 파일에 Firebase 콘솔에서 받은 설정값을 채워넣어야 해요.
// (.env.example 파일을 참고하세요)

import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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

// 브라우저에 낱말 데이터를 캐시해두는 설정이에요.
// 처음 접속할 때는 인터넷에서 받아와야 하지만, 같은 기기·같은 브라우저로
// 다시 들어오면 캐시된 데이터를 먼저 보여주고 뒤에서 최신 내용으로 갱신해서
// 두 번째 방문부터는 훨씬 빠르게 느껴져요.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// 낱말 정보는 두 곳에 나눠서 저장해요.
// 1) words 컬렉션: 표준어/제주어/뜻 같은 "가벼운" 글자 정보만.
//    사전 목록·검색·정렬처럼 자주 불러오는 화면은 이 컬렉션만 읽기 때문에 빨라요.
// 2) wordMedia 컬렉션: 용량이 큰 이미지·음성(base64)만 낱말 id별로 따로 저장.
//    낱말 상세 페이지를 열 때, 그 낱말 하나의 미디어만 그때그때 불러와요.
// (Firestore 문서 하나는 최대 1MB까지만 저장할 수 있어서, 이미지·음성을
//  분리해두면 이미지 1장 + 음성 2개를 합쳐도 넉넉하게 여유가 생겨요.)
const WORDS_COLLECTION = 'words';
const MEDIA_COLLECTION = 'wordMedia';
// 오늘의 낱말처럼 앱 전체에서 하나만 있는 값은 meta 컬렉션에 저장해요.
const META_COLLECTION = 'meta';

const EMPTY_MEDIA = { imageUrl: '', audio: { jeju: '', chuja: '' } };

export async function dbGetWords() {
  const snap = await getDocs(collection(db, WORDS_COLLECTION));
  return snap.docs.map((d) => d.data());
}

export async function dbGetWordMedia(id) {
  const snap = await getDoc(doc(db, MEDIA_COLLECTION, id));
  return snap.exists() ? { ...EMPTY_MEDIA, ...snap.data() } : EMPTY_MEDIA;
}

export async function dbSaveWord(word) {
  const { imageUrl, audio, ...core } = word;
  await Promise.all([
    setDoc(doc(db, WORDS_COLLECTION, word.id), core),
    setDoc(doc(db, MEDIA_COLLECTION, word.id), {
      imageUrl: imageUrl || '',
      audio: audio || { jeju: '', chuja: '' },
    }),
  ]);
}

export async function dbDeleteWord(id) {
  await Promise.all([
    deleteDoc(doc(db, WORDS_COLLECTION, id)),
    deleteDoc(doc(db, MEDIA_COLLECTION, id)),
  ]);
}

export async function dbGetToday() {
  const snap = await getDoc(doc(db, META_COLLECTION, 'today'));
  return snap.exists() ? snap.data() : null;
}

export async function dbSetToday(value) {
  await setDoc(doc(db, META_COLLECTION, 'today'), value);
}
