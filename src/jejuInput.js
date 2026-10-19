// ==================== 아래아(ᆞ) 입력 도우미 ====================
// 기기의 한글 입력기는 아래아를 "글자의 일부"로 몰라서, 입력칸 옆의 [ㆍ 아래아] 버튼으로 넣은 뒤
// 이 파일의 normalizeAraea가 앞뒤 글자를 옛한글 조합용 자모로 다듬어 줘요.
//  - 아래아 글자는 완성형 글자가 없어서 "첫자음(U+1100~) + 아래아(U+119E) + 받침(U+11A8~)"처럼 자모를 이어 붙여 저장해요.
//  - 글꼴은 public/fonts/araea-*.woff(Noto Sans CJK KR 일부)가 이 자모들을 글자 모양으로 합쳐서 보여줘요.

export const AR = '\u119E'; // ᆞ 아래아
export const AR2 = '\u11A2'; // ᆢ 쌍아래아 (아래아 버튼을 연속으로 두 번)
const isAr = (c) => c === AR || c === AR2;

const INIT = {
  'ㄱ': 'ᄀ', 'ㄲ': 'ᄁ', 'ㄴ': 'ᄂ', 'ㄷ': 'ᄃ', 'ㄸ': 'ᄄ', 'ㄹ': 'ᄅ', 'ㅁ': 'ᄆ', 'ㅂ': 'ᄇ',
  'ㅃ': 'ᄈ', 'ㅅ': 'ᄉ', 'ㅆ': 'ᄊ', 'ㅇ': 'ᄋ', 'ㅈ': 'ᄌ', 'ㅉ': 'ᄍ', 'ㅊ': 'ᄎ', 'ㅋ': 'ᄏ',
  'ㅌ': 'ᄐ', 'ㅍ': 'ᄑ', 'ㅎ': 'ᄒ',
};
const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const JUNG = ['ㅏ', 'ㅐ', 'ㅑ', 'ㅒ', 'ㅓ', 'ㅔ', 'ㅕ', 'ㅖ', 'ㅗ', 'ㅘ', 'ㅙ', 'ㅚ', 'ㅛ', 'ㅜ', 'ㅝ', 'ㅞ', 'ㅟ', 'ㅠ', 'ㅡ', 'ㅢ', 'ㅣ'];
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const DOUBLE = { 'ㄱㅅ': 'ㄳ', 'ㄴㅈ': 'ㄵ', 'ㄴㅎ': 'ㄶ', 'ㄹㄱ': 'ㄺ', 'ㄹㅁ': 'ㄻ', 'ㄹㅂ': 'ㄼ', 'ㄹㅅ': 'ㄽ', 'ㄹㅌ': 'ㄾ', 'ㄹㅍ': 'ㄿ', 'ㄹㅎ': 'ㅀ', 'ㅂㅅ': 'ㅄ' };
const SPLIT = {};
Object.entries(DOUBLE).forEach(([k, v]) => { SPLIT[v] = [k[0], k[1]]; });
const VCOMBO = { 'ㅗㅏ': 'ㅘ', 'ㅗㅐ': 'ㅙ', 'ㅗㅣ': 'ㅚ', 'ㅜㅓ': 'ㅝ', 'ㅜㅔ': 'ㅞ', 'ㅜㅣ': 'ㅟ', 'ㅡㅣ': 'ㅢ' };
const SIMPLE_FINAL = new Set(['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']);
const isCons = (c) => CHO.includes(c);
const isVow = (c) => JUNG.includes(c);
const isSyl = (c) => c >= '가' && c <= '힣';
const isJong = (c) => c >= 'ᆨ' && c <= 'ᇂ';

function jongChar(letters) {
  const k = letters.length > 1 ? DOUBLE[letters.join('')] : letters[0];
  const i = JONG.indexOf(k);
  return i > 0 ? String.fromCharCode(0x11a7 + i) : null;
}

function decompose(ch) {
  if (isSyl(ch)) {
    const n = ch.charCodeAt(0) - 0xac00;
    const T = n % 28;
    const V = Math.floor(n / 28) % 21;
    const L = Math.floor(n / 588);
    const o = [CHO[L], JUNG[V]];
    if (T) {
      const t = JONG[T];
      o.push(...(SPLIT[t] || [t]));
    }
    return o;
  }
  if (isJong(ch)) {
    const t = JONG[ch.charCodeAt(0) - 0x11a7];
    return SPLIT[t] || [t];
  }
  return [ch];
}

// 아래아 바로 뒤에 친 글자들을 조합: 첫 자음이 (뒤에 모음이 안 오면) 아래아의 받침이 되고, 나머지는 일반 한글로 조합해요.
function composeZone(letters) {
  let k = 0;
  let fin = '';
  if (letters.length && isCons(letters[0]) && !(letters[1] && isVow(letters[1]))) {
    const two = letters[1] && isCons(letters[1]) && DOUBLE[letters[0] + letters[1]] && !(letters[2] && isVow(letters[2]));
    if (two) {
      fin = jongChar([letters[0], letters[1]]);
      k = 2;
    } else if (SIMPLE_FINAL.has(letters[0])) {
      fin = jongChar([letters[0]]);
      k = 1;
    }
  }
  let out = '';
  let cur = null;
  const flush = () => {
    if (!cur) return;
    if (cur.L && cur.V) {
      const t = cur.T && cur.T.length ? JONG.indexOf(cur.T.length > 1 ? DOUBLE[cur.T.join('')] : cur.T[0]) : 0;
      out += String.fromCharCode(0xac00 + (CHO.indexOf(cur.L) * 21 + JUNG.indexOf(cur.V)) * 28 + t);
    } else if (cur.L) out += cur.L;
    else if (cur.V) out += cur.V;
    cur = null;
  };
  for (const x of letters.slice(k)) {
    if (isCons(x)) {
      if (!cur) cur = { L: x };
      else if (!cur.V) { flush(); cur = { L: x }; }
      else if (!cur.T && SIMPLE_FINAL.has(x)) cur.T = [x];
      else if (cur.T && cur.T.length === 1 && DOUBLE[cur.T[0] + x]) cur.T = [cur.T[0], x];
      else { flush(); cur = { L: x }; }
    } else if (isVow(x)) {
      if (!cur) cur = { V: x };
      else if (!cur.V && cur.L) cur.V = x;
      else if (cur.V && cur.T && cur.T.length) {
        const mv = cur.T.length > 1 ? cur.T[1] : cur.T[0];
        cur.T = cur.T.length > 1 ? [cur.T[0]] : null;
        flush();
        cur = { L: mv, V: x };
      } else if (cur.V && !cur.T && VCOMBO[cur.V + x]) cur.V = VCOMBO[cur.V + x];
      else { flush(); cur = { V: x }; }
    } else {
      flush();
      out += x;
    }
  }
  flush();
  return { fin, rest: out };
}

// 입력 직후(글자 조합이 끝난 뒤) 호출해요. caret = 커서 위치. 돌려주는 값: { text, caret }
export function normalizeAraea(text, caret) {
  const src = String(text || '');
  // 1) "자음 + ㆍ(가운뎃 아래아)" 또는 아래아 → "첫자음 + 아래아". 자음이 없으면 ㅇ을 붙여요.
  let out = '';
  let c = caret;
  let pos = 0;
  const arr = Array.from(src);
  for (let i = 0; i < arr.length; i++) {
    const ch = arr[i];
    if (ch === 'ㆍ' || ch === AR) {
      const prev = out.length ? Array.from(out).pop() : '';
      if (INIT[prev]) {
        out = out.slice(0, -prev.length) + INIT[prev] + AR;
        if (caret > pos) c += 1;
      } else if (prev === AR && ch === AR) {
        // 아래아 바로 뒤에 아래아를 또 넣으면 쌍아래아(ᆢ)
        out = out.slice(0, -1) + AR2;
        if (caret > pos) c -= 1;
      } else if (prev === AR2) {
        // 쌍아래아 뒤에는 더 붙이지 않아요.
        if (caret > pos) c -= 1;
      } else if (/[\u1100-\u1112]/.test(prev)) {
        out += AR;
      } else {
        out += 'ᄋ' + AR;
        if (caret > pos) c += 1;
      }
    } else {
      out += ch;
    }
    pos += ch.length;
  }
  // 2) 커서 앞쪽 "아래아 + 방금 친 글자들"을 조합해서 받침을 붙여요.
  const before = out.slice(0, c);
  const after = out.slice(c);
  const chars = Array.from(before);
  let j = chars.length;
  while (j > 0 && chars.length - j < 8 && (/[ㄱ-ㅣ]/.test(chars[j - 1]) || isSyl(chars[j - 1]) || isJong(chars[j - 1]))) j--;
  if (j > 0 && isAr(chars[j - 1]) && j < chars.length) {
    const zone = chars.slice(j);
    const letters = [];
    zone.forEach((z) => letters.push(...decompose(z)));
    const r = composeZone(letters);
    const nz = r.fin + r.rest;
    if (nz !== zone.join('')) {
      const head = chars.slice(0, j).join('');
      out = head + nz + after;
      c = (head + nz).length;
    }
  }
  return { text: out, caret: Math.min(c, out.length) };
}

// 저장할 때 마지막으로 한 번 더 정리해요. (조합 중이던 받침이 낱자로 남지 않게)
export function finalizeAraea(text) {
  const s = String(text || '');
  return normalizeAraea(s, s.length).text;
}
