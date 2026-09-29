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

// 이전에는 브라우저 로컬 캐시(persistentLocalCache)를 켜뒀었는데, 그러면
// 저장 요청이 실제로 서버까지 갔는지와 상관없이 화면에는 항상 "성공한 것처럼"
// 보일 수 있어서(로컬 캐시에서 읽으니까) 문제 진단이 어려워졌어요.
// 그래서 지금은 매번 실제 서버와 직접 통신하는 기본 방식으로 되돌렸어요 —
// 저장이 실패하면 바로 화면에 에러가 뜨도록요.
export const db = getFirestore(app);

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
// 제주어 속담은 승인 절차 없이 관리자가 바로 추가·수정·삭제하는 별도 컬렉션이에요.
const PROVERB_COLLECTION = 'proverbs';

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

// ==================== 제주어 속담 ====================
export async function dbGetProverbs() {
  const snap = await getDocs(collection(db, PROVERB_COLLECTION));
  return snap.docs.map((d) => d.data());
}

export async function dbSaveProverb(proverb) {
  await setDoc(doc(db, PROVERB_COLLECTION, proverb.id), proverb);
}

export async function dbDeleteProverb(id) {
  await deleteDoc(doc(db, PROVERB_COLLECTION, id));
}

export async function dbGetTodayProverb() {
  const snap = await getDoc(doc(db, META_COLLECTION, 'todayProverb'));
  return snap.exists() ? snap.data() : null;
}

export async function dbSetTodayProverb(value) {
  await setDoc(doc(db, META_COLLECTION, 'todayProverb'), value);
}
