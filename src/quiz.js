// ==================== 오늘의 퀴즈 로직 ====================
// 화면(React)과 상관없는 순수 함수들이라, 따로 떼어서 테스트하기 쉽게 만들었어요.

// 하루에 한 번만 풀 수 있게 막는 기준이에요.
//  - 'ip'     : 접속한 곳의 IP 주소가 같으면 같은 사람으로 봐요.
//  - 'device' : 같은 기기(브라우저)면 같은 사람으로 봐요. (기본값)
// ※ 학교 와이파이처럼 한 건물의 모든 기기가 같은 IP를 쓰는 곳에서는 'ip'로 하면
//   학교 전체에서 단 한 명만 풀 수 있어요. 교실에서 쓸 거라면 'device'를 권해요.
export const QUIZ_LIMIT_BY = 'device';

// 대한민국(KST, UTC+9) 기준 오늘 날짜 'YYYY-MM-DD'. 매일 0시에 바뀌어요.
export function kstDateString(now = Date.now()) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// 같은 씨앗(seed)이면 항상 같은 순서로 섞어주는 난수 생성기
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(list, seed) {
  const arr = [...list];
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clean(v) {
  return (v || '').trim();
}

// 낱말 하나에서 "표준어가 아닌 말"(제주어, 추자생활언어, 다른 지역 말) 후보를 뽑아요.
function dialectsOf(word) {
  const standard = clean(word.standard);
  const list = [];
  const ex = word.examples || {};
  if (clean(word.jeju) && clean(word.jeju) !== standard) {
    list.push({ label: '제주어', text: clean(word.jeju), example: clean(ex.jeju) });
  }
  if (clean(word.chuja) && clean(word.chuja) !== standard) {
    list.push({ label: '추자생활언어', text: clean(word.chuja), example: clean(ex.chuja) });
  }
  const extra = word.extraDialect;
  if (extra && clean(extra.word) && clean(extra.word) !== standard) {
    list.push({ label: clean(extra.regionLabel) || '다른 지역', text: clean(extra.word), example: clean(extra.example) });
  }
  return list;
}

// 오늘의 문제를 만들어요. 같은 날짜 + 같은 낱말 목록이면 항상 똑같은 문제가 나와요.
// 만들 수 없으면(낱말이 부족하면) null.
export function buildQuizQuestion(words, dateStr) {
  const pool = words
    .filter((w) => w.status === 'approved' && !w.hidden && (w.kind || 'word') === 'word' && clean(w.standard))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const candidates = [];
  pool.forEach((w) => {
    dialectsOf(w).forEach((d) => candidates.push({ word: w, dialect: d }));
  });
  const standards = [...new Set(pool.map((w) => clean(w.standard)))];
  if (candidates.length === 0 || standards.length < 3) return null;

  const picked = candidates[hashString(dateStr) % candidates.length];
  const answer = clean(picked.word.standard);
  const others = seededShuffle(
    standards.filter((s) => s !== answer),
    hashString(`${dateStr}|distractor`)
  ).slice(0, 2);
  const choices = seededShuffle([answer, ...others], hashString(`${dateStr}|choices`));

  return {
    date: dateStr,
    wordId: picked.word.id,
    dialectLabel: picked.dialect.label,
    dialectText: picked.dialect.text,
    example: picked.dialect.example,
    choices,
    answer,
  };
}

// ==================== 누가 풀었는지 구분하는 키 ====================
let cachedUserKey = null;

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getDeviceId() {
  const KEY = 'jejumal:deviceId';
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch (e) {
    return 'unknown';
  }
}

// IP 주소는 그대로 저장하지 않고, 한 방향으로 섞은 값(해시)만 써요.
// IP를 확인하지 못하면(차단되었거나 인터넷 문제) 기기 기준으로 대신 확인해요.
export async function getQuizUserKey() {
  if (cachedUserKey) return cachedUserKey;
  let key = null;
  if (QUIZ_LIMIT_BY === 'ip') {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json();
      if (data && data.ip) key = `ip-${(await sha256Hex(`jejumal-quiz|${data.ip}`)).slice(0, 32)}`;
    } catch (e) {
      // IP 확인 실패 → 아래에서 기기 기준으로 대체
    }
  }
  if (!key) key = `dev-${getDeviceId()}`;
  cachedUserKey = key;
  return key;
}

export function quizAttemptId(dateStr, userKey) {
  return `${dateStr}_${userKey}`;
}
