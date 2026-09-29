import React, { useState, useEffect, useRef } from 'react';
import { Home, BookOpen, PenSquare, ShieldCheck, Sparkles, ChevronRight, Shuffle, Mic, Square } from 'lucide-react';
import { dbGetWords, dbGetWordMedia, dbSaveWord, dbDeleteWord, dbGetToday, dbSetToday } from './firebase';

// ==================== 상수 ====================
const NICK_KEY = 'jejumal:nickname'; // 닉네임은 각자 기기(브라우저)에만 저장돼요.
const ADMIN_PIN = '0640'; // 데모용 임시 PIN. 실제 서비스에서는 반드시 별도 로그인으로 교체하세요.
// Firestore 문서 하나는 최대 1MB까지만 저장할 수 있어서, Claude 미리보기 버전보다
// 이미지/음성 용량 제한을 줄여뒀어요. (이미지 1장 + 음성 2개를 합쳐도 1MB를 넘지 않도록)
const MAX_IMAGE_BYTES = 500000; // 이미지 첨부 용량 제한(약 500KB, base64 인코딩 후 기준)
const MAX_IMAGE_DIMENSION = 700; // 첨부 이미지 리사이즈 기준(긴 변, px)
const MAX_AUDIO_BYTES = 200000; // 음성 첨부 용량 제한(약 200KB, base64 인코딩 후 기준)
const MAX_RECORD_MS = 15000; // 녹음 최대 길이(15초)
const EXTRA_REGIONS = [
  { key: 'chungcheong', label: '충청도' },
  { key: 'gyeongsang', label: '경상도' },
  { key: 'gangwon', label: '강원도' },
  { key: 'other', label: '기타 지역' },
];

// ==================== 유틸 함수 ====================
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function sortWords(list, field, direction) {
  const sorted = [...list].sort((a, b) => {
    let cmp;
    if (field === 'createdAt') {
      cmp = new Date(a.registeredAt || 0).getTime() - new Date(b.registeredAt || 0).getTime();
    } else {
      cmp = (a[field] || '').localeCompare(b[field] || '', 'ko');
    }
    return direction === 'desc' ? -cmp : cmp;
  });
  return sorted;
}

function filterWords(list, term) {
  if (!term.trim()) return list;
  const t = term.trim().toLowerCase();
  return list.filter((w) => [w.standard, w.jeju, w.chuja].some((v) => (v || '').toLowerCase().includes(t)));
}

function resizeImageFile(file, maxDimension, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일을 읽을 수 없어요.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('이미지를 불러올 수 없어요.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function getOrPickTodayWord(approvedWords) {
  const dateStr = new Date().toISOString().slice(0, 10);
  try {
    const saved = await dbGetToday();
    if (saved && saved.date === dateStr) {
      const found = approvedWords.find((w) => w.id === saved.wordId);
      if (found) return found;
    }
  } catch (e) {
    // 저장된 값이 없으면 새로 고른다
  }
  if (approvedWords.length === 0) return null;
  const idx = hashString(dateStr) % approvedWords.length;
  const picked = approvedWords[idx];
  try {
    await dbSetToday({ date: dateStr, wordId: picked.id });
  } catch (e) {
    // 저장 실패해도 화면에는 표시
  }
  return picked;
}

// ==================== 공통 스타일 ====================
function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Jua&family=Noto+Sans+KR:wght@400;500;700&display=swap');

      .jejumal-app {
        --basalt-900: #4B3F72;
        --paper-50: #FFF7E8;
        --paper-100: #FFEFD1;
        --ink-800: #33304D;
        --ink-500: #7A7396;
        --tangerine-500: #FF8A3D;
        --tangerine-600: #E36A1A;
        --tangerine-100: #FFE3C7;
        --sea-600: #22C3B6;
        --sea-700: #128F85;
        --sea-100: #D6F5F1;
        --canola-400: #FFC93C;
        --canola-600: #C99400;
        --canola-100: #FFF3C7;
        --accent-500: #5FA044;
        --accent-600: #457A30;
        --accent-700: #335E22;
        --accent-100: #E9F1D9;
        --danger-600: #E0504F;
        --danger-border: #FFD1D1;
        --line: #FFE3B0;
        --white: #FFFFFF;
        font-family: 'Noto Sans KR', sans-serif;
        color: var(--ink-800);
        background: var(--paper-50);
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      }
      .jejumal-app * { box-sizing: border-box; }
      .jejumal-app button, .jejumal-app input, .jejumal-app textarea {
        font-family: inherit;
        font-size: 1rem;
      }
      .jejumal-app :focus-visible {
        outline: 3px solid var(--accent-500);
        outline-offset: 2px;
      }
      .db-error-banner {
        background: #FDEAEA; color: var(--danger-600); border-bottom: 2px solid var(--danger-border);
        padding: 0.7rem 1.25rem; display: flex; align-items: center; justify-content: space-between;
        gap: 1rem; font-size: 0.85rem; line-height: 1.5;
      }
      .db-error-close {
        background: none; border: none; color: var(--danger-600); cursor: pointer;
        font-size: 1rem; flex-shrink: 0; padding: 0.1rem 0.3rem;
      }
      .app-header {
        background: var(--white);
        color: var(--ink-800);
        padding: 1.25rem 1.5rem 0.85rem;
        position: sticky;
        top: 0;
        z-index: 10;
        border-bottom: 3px solid var(--line);
      }
      .brand {
        font-family: 'Jua', sans-serif;
        font-weight: 400;
        font-size: 1.55rem;
        margin: 0 0 0.9rem;
        color: var(--accent-600);
      }
      .nav-tabs { display: flex; gap: 0.5rem; overflow-x: auto; white-space: nowrap; padding-bottom: 0.15rem; }
      .nav-tab {
        display: inline-flex; align-items: center; gap: 0.35rem;
        background: var(--paper-100); border: none; color: var(--ink-500); opacity: 1;
        padding: 0.5rem 0.95rem; border-radius: 999px; cursor: pointer; font-weight: 500; font-size: 0.9rem;
      }
      .nav-tab.active { background: var(--accent-500); color: var(--white); }
      .app-main { flex: 1; max-width: 760px; width: 100%; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
      .view-title { font-family: 'Jua', sans-serif; font-weight: 400; font-size: 1.6rem; margin: 0 0 0.5rem; }
      .view-desc { color: var(--ink-500); margin: 0 0 1.25rem; line-height: 1.6; }
      .eyebrow-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
      .eyebrow { display: flex; align-items: center; gap: 0.35rem; color: var(--accent-600); margin: 0; font-weight: 500; }
      .shuffle-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; border-radius: 999px; border: 2px solid var(--accent-500);
        background: var(--white); color: var(--accent-600); cursor: pointer;
      }
      .shuffle-btn:hover { background: var(--accent-100); }
      .today-card { border: none; border-radius: 24px; padding: 2rem 1.75rem; background: var(--accent-100); box-shadow: 0 6px 0 var(--accent-500); }
      .today-hero {
        font-family: 'Jua', sans-serif; font-weight: 400; font-size: clamp(2.2rem, 7vw, 3.2rem);
        color: var(--accent-600); margin: 0 0 0.5rem; line-height: 1.15;
      }
      .today-sub { color: var(--ink-500); margin: 0 0 1rem; font-weight: 500; }
      .today-image img { max-width: 100%; border-radius: 16px; margin-bottom: 1rem; display: block; }
      .today-example {
        font-style: italic; color: var(--ink-800); border-left: 3px solid var(--sea-600);
        padding-left: 0.75rem; margin: 0 0 1rem;
      }
      .intro { margin-top: 1.75rem; line-height: 1.7; }
      .stat { color: var(--sea-700); font-weight: 500; }
      .chip {
        display: inline-block; font-size: 0.75rem; padding: 0.2rem 0.6rem;
        border-radius: 999px; margin-right: 0.4rem; font-weight: 500;
      }
      .chip-standard { background: var(--basalt-900); color: var(--white); }
      .chip-jeju { background: var(--tangerine-500); color: var(--white); }
      .chip-chuja { background: var(--sea-600); color: var(--white); }
      .chip-extra { background: var(--canola-400); color: var(--ink-800); }
      .search-input {
        width: 100%; padding: 0.7rem 1rem; border: 2px solid var(--line);
        border-radius: 16px; background: var(--white); margin-bottom: 0.9rem;
      }
      .sort-tabs, .admin-tabs { display: flex; gap: 0.4rem; margin-bottom: 1rem; flex-wrap: wrap; }
      .sort-tab {
        border: 2px solid var(--line); background: var(--white); padding: 0.45rem 0.9rem;
        border-radius: 999px; cursor: pointer; color: var(--ink-500); font-size: 0.85rem; font-weight: 500;
      }
      .sort-tab.active { border-color: var(--sea-600); color: var(--white); background: var(--sea-600); }
      .dict-controls { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }
      .dict-controls-row { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
      .dict-controls-label { font-size: 0.78rem; color: var(--ink-500); margin-right: 0.2rem; font-weight: 500; }
      .word-list { display: flex; flex-direction: column; gap: 0.6rem; }
      .word-list-header {
        display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 0.5rem;
        padding: 0 0.25rem 0.5rem; font-size: 0.78rem; color: var(--ink-500); font-weight: 500;
      }
      .word-row { border-bottom: none; }
      .word-row-head {
        width: 100%; display: flex; flex-direction: column; gap: 0.3rem;
        background: var(--white); border: 2px solid var(--line); border-radius: 16px;
        padding: 0.85rem 1rem; text-align: left; cursor: pointer; color: var(--ink-800);
      }
      .word-row-head:hover { border-color: var(--accent-500); }
      .word-row-main { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 0.5rem; align-items: center; }
      .word-value { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.95rem; font-weight: 500; }
      .word-value.standard { color: var(--ink-800); }
      .word-value.jeju { color: var(--tangerine-600); }
      .word-value.chuja { color: var(--sea-700); }
      .word-arrow { color: var(--ink-500); font-size: 1.1rem; justify-self: end; display: inline-flex; }
      .word-meaning { margin: 0; font-size: 0.8rem; color: var(--ink-500); font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .back-btn { margin-bottom: 1.25rem; }
      .detail-card {
        background: var(--white); border: 1px solid var(--line); border-radius: 18px;
        padding: 1.1rem 1.25rem;
      }
      .detail-header-card { margin-bottom: 1.1rem; }
      .detail-card-title {
        margin: 0 0 0.7rem; font-size: 0.76rem; font-weight: 700; color: var(--ink-500);
        text-transform: uppercase; letter-spacing: 0.04em;
      }
      .detail-legend { margin: 0 0 0.7rem; }
      .detail-word-line {
        display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap;
        font-family: 'Jua', sans-serif; font-weight: 400; font-size: 1.6rem; margin: 0;
      }
      .detail-word-line .sep { color: var(--ink-500); font-size: 1rem; }
      .detail-word-line .standard { color: var(--ink-800); }
      .detail-word-line .jeju { color: var(--tangerine-600); }
      .detail-word-line .chuja { color: var(--sea-700); }
      .detail-extra-line {
        display: flex; align-items: center; gap: 0.5rem; font-size: 0.95rem; color: var(--canola-600);
        font-weight: 500; margin: 0.85rem 0 0; padding-top: 0.85rem; border-top: 1px solid var(--paper-100);
      }
      .detail-meaning {
        color: var(--ink-500); margin: 0.85rem 0 0; padding-top: 0.85rem;
        border-top: 1px solid var(--paper-100); line-height: 1.6;
      }
      .word-detail { padding: 0 0.25rem 1.25rem; display: flex; flex-direction: column; gap: 1.1rem; }
      .detail-image { padding: 0.6rem; }
      .detail-image img { max-width: 100%; border-radius: 14px; display: block; }
      .detail-examples { display: flex; flex-direction: column; }
      .detail-examples p {
        margin: 0; padding: 0.6rem 0; border-bottom: 1px solid var(--paper-100);
      }
      .detail-examples p:last-child { border-bottom: none; padding-bottom: 0; }
      .detail-examples > p:first-child { padding-top: 0; }
      .detail-audio-row { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
      .detail-audio-row audio { height: 34px; max-width: 220px; }
      .detail-meta-card { display: flex; flex-direction: column; gap: 0.9rem; }
      .detail-meta { display: flex; gap: 1rem; flex-wrap: wrap; color: var(--ink-500); font-size: 0.8rem; }
      .muted { color: var(--ink-500); }
      .muted.small { font-size: 0.8rem; }
      .word-form { display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.5rem; }
      .form-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.6rem; }
      @media (max-width: 640px) { .form-grid { grid-template-columns: 1fr; } }
      .form-subtitle { margin: 0.4rem 0 -0.2rem; color: var(--ink-500); font-size: 0.85rem; font-weight: 500; }
      .form-error { color: var(--danger-600); font-size: 0.85rem; margin: 0; font-weight: 500; }
      .form-actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
      .field { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; color: var(--ink-500); }
      .field-input, .field-textarea {
        border: 2px solid var(--line); border-radius: 14px; padding: 0.6rem 0.75rem;
        background: var(--white); color: var(--ink-800); resize: vertical;
      }
      .accent-jeju .field-input, .accent-jeju .field-textarea { border-color: var(--tangerine-500); }
      .accent-chuja .field-input, .accent-chuja .field-textarea { border-color: var(--sea-600); }
      .accent-extra .field-input, .accent-extra .field-textarea { border-color: var(--canola-600); }
      .extra-region-tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; }
      .extra-region-tab {
        border: 2px solid var(--line); background: var(--white); padding: 0.45rem 0.9rem;
        border-radius: 999px; cursor: pointer; color: var(--ink-500); font-size: 0.85rem; font-weight: 500;
      }
      .extra-region-tab.active { border-color: var(--canola-600); color: var(--ink-800); background: var(--canola-400); }
      .extra-region-block { display: flex; flex-direction: column; gap: 0.75rem; padding: 0.9rem; border: 2px dashed var(--line); border-radius: 16px; }
      .req { color: var(--accent-600); margin-left: 0.15rem; }
      .image-preview img { max-width: 200px; border-radius: 14px; margin-top: -0.4rem; }
      .image-preview { display: flex; flex-direction: column; align-items: flex-start; gap: 0.5rem; }
      .field-file { border: 2px dashed var(--line); border-radius: 14px; padding: 0.5rem; background: var(--white); }
      .image-remove { padding: 0.3rem 0.7rem; font-size: 0.8rem; }
      .audio-field { gap: 0.5rem; }
      .audio-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; }
      .audio-record-btn { display: inline-flex; align-items: center; gap: 0.35rem; }
      .audio-preview { display: flex; flex-wrap: wrap; align-items: center; gap: 0.6rem; margin-top: 0.2rem; }
      .audio-preview audio { max-width: 100%; height: 36px; }
      .btn-primary, .btn-secondary, .btn-ghost {
        border-radius: 999px; padding: 0.6rem 1.3rem; cursor: pointer; font-weight: 500; border: 2px solid transparent;
        transition: transform 0.05s ease;
      }
      .btn-primary { background: var(--accent-500); color: var(--white); box-shadow: 0 4px 0 var(--accent-600); }
      .btn-primary:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--accent-600); }
      .btn-secondary { background: var(--accent-600); color: var(--white); box-shadow: 0 4px 0 var(--accent-700); }
      .btn-secondary:active { transform: translateY(3px); box-shadow: 0 1px 0 var(--accent-700); }
      .btn-ghost { background: var(--white); border-color: var(--line); color: var(--ink-800); }
      .btn-ghost:hover { border-color: var(--accent-500); }
      .btn-ghost.danger { color: var(--danger-600); border-color: var(--danger-border); }
      .comments { display: flex; flex-direction: column; gap: 0.6rem; }
      .comments-title { margin: 0; font-weight: 500; }
      .comment-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
      .comment-item { background: var(--white); border: 2px solid var(--line); border-radius: 14px; padding: 0.6rem 0.75rem; }
      .comment-meta { display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--ink-500); margin-bottom: 0.2rem; }
      .comment-item p { margin: 0; }
      .comment-empty { color: var(--ink-500); font-size: 0.85rem; }
      .comment-form { display: flex; flex-direction: column; gap: 0.5rem; }
      .notice-card { border: 2px solid var(--line); border-radius: 18px; padding: 1.25rem; background: var(--white); display: flex; flex-direction: column; gap: 0.75rem; }
      .pin-form { display: flex; flex-direction: column; gap: 0.75rem; max-width: 260px; }
      .pending-list { display: flex; flex-direction: column; gap: 0.9rem; }
      .pending-item, .admin-word-item {
        border: 2px solid var(--line); border-radius: 18px; padding: 0.9rem 1rem;
        background: var(--white); display: flex; flex-direction: column; gap: 0.5rem;
      }
      .pending-type { margin: 0; font-size: 0.78rem; color: var(--sea-700); font-weight: 500; }
      .pending-fields { display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.92rem; }
      .pending-image-preview img { max-width: 140px; border-radius: 12px; display: block; }
      .stats-list { display: flex; flex-direction: column; gap: 0.6rem; }
      .stats-row { display: grid; grid-template-columns: 22px minmax(60px, 110px) 1fr 44px; gap: 0.7rem; align-items: center; }
      .stats-rank { font-weight: 500; color: var(--ink-500); text-align: center; }
      .stats-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .stats-bar-track { background: var(--paper-100); border-radius: 999px; height: 12px; overflow: hidden; }
      .stats-bar-fill { background: var(--accent-500); height: 100%; border-radius: 999px; }
      .stats-count { text-align: right; color: var(--ink-500); font-size: 0.85rem; }
      .confirm-inline { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--ink-500); flex-wrap: wrap; }
      .empty-state { color: var(--ink-500); padding: 1.5rem 0; }
      .loading { color: var(--ink-500); padding: 2rem 0; text-align: center; }
      .app-footer { text-align: center; padding: 1.25rem; color: var(--ink-500); font-size: 0.8rem; border-top: 3px solid var(--line); }
    `}</style>
  );
}

// ==================== 작은 컴포넌트 ====================
function Chip({ type, children }) {
  return <span className={`chip chip-${type}`}>{children}</span>;
}

function Field({ label, value, onChange, required, placeholder, accent, type, onEnter }) {
  return (
    <label className={`field ${accent ? 'accent-' + accent : ''}`}>
      <span className="field-label">
        {label}
        {required && <span className="req">*</span>}
      </span>
      <input
        className="field-input"
        type={type || 'text'}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) onEnter();
        }}
      />
    </label>
  );
}

function TextArea({ label, value, onChange, accent }) {
  return (
    <label className={`field ${accent ? 'accent-' + accent : ''}`}>
      <span className="field-label">{label}</span>
      <textarea className="field-textarea" rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('오디오 파일을 읽을 수 없어요.'));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function AudioField({ label, value, onChange, accent }) {
  const [recording, setRecording] = useState(false);
  const [micSupported, setMicSupported] = useState(true);
  const [notice, setNotice] = useState('');
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function cleanupStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  async function startRecording() {
    setNotice('');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMicSupported(false);
      setNotice('이 화면에서는 바로 녹음할 수 없어요. 음성 파일을 첨부해주세요.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        cleanupStream();
        setRecording(false);
        if (chunksRef.current.length === 0) return;
        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          const dataUrl = await blobToDataUrl(blob);
          if (dataUrl.length > MAX_AUDIO_BYTES) {
            setNotice('녹음이 너무 길어요. 더 짧게 다시 녹음해주세요.');
          } else {
            onChange(dataUrl);
          }
        } catch (err) {
          setNotice('녹음 파일을 저장하는 중 문제가 생겼어요.');
        }
      };
      recorder.start();
      setRecording(true);
      timerRef.current = setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, MAX_RECORD_MS);
    } catch (err) {
      setMicSupported(false);
      setRecording(false);
      setNotice('마이크를 사용할 수 없어요. 음성 파일을 첨부해주세요.');
    }
  }

  function stopRecording() {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    } else {
      cleanupStream();
      setRecording(false);
    }
  }

  function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setNotice('');
    const reader = new FileReader();
    reader.onerror = () => setNotice('오디오 파일을 읽을 수 없어요.');
    reader.onload = () => {
      if (reader.result.length > MAX_AUDIO_BYTES) {
        setNotice('음성 파일 용량이 너무 커요. 더 짧은 파일을 선택해주세요.');
      } else {
        onChange(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className={`field audio-field ${accent ? 'accent-' + accent : ''}`}>
      <span className="field-label">{label}</span>
      <div className="audio-controls">
        {micSupported && (
          !recording ? (
            <button type="button" className="btn-ghost audio-record-btn" onClick={startRecording}>
              <Mic size={16} /> 바로 녹음하기
            </button>
          ) : (
            <button type="button" className="btn-ghost danger audio-record-btn" onClick={stopRecording}>
              <Square size={16} /> 녹음 중지 (최대 15초)
            </button>
          )
        )}
        <input type="file" accept="audio/*" className="field-file" onChange={handleFile} />
      </div>
      {notice && <p className="muted small">{notice}</p>}
      {value && (
        <div className="audio-preview">
          <audio controls src={value} />
          <button type="button" className="btn-ghost danger image-remove" onClick={() => onChange('')}>음성 제거</button>
        </div>
      )}
    </div>
  );
}

// ==================== 단어 등록/수정 공용 폼 ====================
function WordForm({ initial, defaultNickname, submitLabel, onSubmit, onCancel }) {
  const [standard, setStandard] = useState(initial?.standard || '');
  const [jeju, setJeju] = useState(initial?.jeju || '');
  const [chuja, setChuja] = useState(initial?.chuja || '');
  const [meaning, setMeaning] = useState(initial?.meaning || '');
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl || '');
  const [imageProcessing, setImageProcessing] = useState(false);
  const [exJeju, setExJeju] = useState(initial?.examples?.jeju || '');
  const [exChuja, setExChuja] = useState(initial?.examples?.chuja || '');
  const [audioJeju, setAudioJeju] = useState(initial?.audio?.jeju || '');
  const [audioChuja, setAudioChuja] = useState(initial?.audio?.chuja || '');
  const [extraRegionKey, setExtraRegionKey] = useState(initial?.extraDialect?.region || '');
  const [extraRegionCustomLabel, setExtraRegionCustomLabel] = useState(
    initial?.extraDialect?.region === 'other' ? initial.extraDialect.regionLabel || '' : ''
  );
  const [extraWord, setExtraWord] = useState(initial?.extraDialect?.word || '');
  const [extraExample, setExtraExample] = useState(initial?.extraDialect?.example || '');
  const [nickname, setNickname] = useState(defaultNickname || '');
  const [error, setError] = useState('');

  const extraRegionPreset = EXTRA_REGIONS.find((r) => r.key === extraRegionKey);
  const extraRegionDisplayLabel = extraRegionKey === 'other' ? extraRegionCustomLabel.trim() : extraRegionPreset?.label || '';

  function handleSelectExtraRegion(key) {
    if (extraRegionKey === key) {
      setExtraRegionKey('');
      setExtraRegionCustomLabel('');
      setExtraWord('');
      setExtraExample('');
    } else {
      setExtraRegionKey(key);
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setImageProcessing(true);
    try {
      const dataUrl = await resizeImageFile(file, MAX_IMAGE_DIMENSION, 0.8);
      if (dataUrl.length > MAX_IMAGE_BYTES) {
        setError('이미지 용량이 너무 커요. 더 작은 사진을 선택해주세요.');
      } else {
        setImageUrl(dataUrl);
      }
    } catch (err) {
      setError('이미지를 처리하는 중 문제가 생겼어요. 다른 사진으로 다시 시도해주세요.');
    } finally {
      setImageProcessing(false);
    }
  }

  function handleRemoveImage() {
    setImageUrl('');
  }

  function handleSubmit() {
    if (!standard.trim() || !jeju.trim() || !chuja.trim()) {
      setError('표준어, 제주어, 추자생활언어는 모두 입력해야 해요.');
      return;
    }
    if (!nickname.trim()) {
      setError('닉네임을 입력해주세요.');
      return;
    }
    if (extraRegionKey === 'other' && !extraRegionCustomLabel.trim()) {
      setError('기타 지역의 이름을 입력해주세요.');
      return;
    }
    if (extraRegionKey && !extraWord.trim()) {
      setError('선택한 지역의 낱말을 입력해주세요.');
      return;
    }
    setError('');
    onSubmit({
      standard: standard.trim(),
      jeju: jeju.trim(),
      chuja: chuja.trim(),
      meaning: meaning.trim(),
      imageUrl: imageUrl.trim(),
      examples: { jeju: exJeju.trim(), chuja: exChuja.trim() },
      audio: { jeju: audioJeju, chuja: audioChuja },
      extraDialect: extraRegionKey
        ? {
            region: extraRegionKey,
            regionLabel: extraRegionDisplayLabel,
            word: extraWord.trim(),
            example: extraExample.trim(),
          }
        : null,
      nickname: nickname.trim(),
    });
  }

  return (
    <div className="word-form">
      <div className="form-grid">
        <Field label="표준어" required value={standard} onChange={setStandard} />
        <Field label="제주어" required value={jeju} onChange={setJeju} accent="jeju" />
        <Field label="추자생활언어" required value={chuja} onChange={setChuja} accent="chuja" />
      </div>
      <TextArea label="뜻 (선택)" value={meaning} onChange={setMeaning} />
      <p className="form-subtitle">다른 지역 언어 추가 (선택)</p>
      <div className="extra-region-tabs">
        {EXTRA_REGIONS.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`extra-region-tab ${extraRegionKey === r.key ? 'active' : ''}`}
            onClick={() => handleSelectExtraRegion(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>
      {extraRegionKey && (
        <div className="extra-region-block">
          {extraRegionKey === 'other' && (
            <Field
              label="지역 이름"
              required
              value={extraRegionCustomLabel}
              onChange={setExtraRegionCustomLabel}
              placeholder="예: 전라도"
              accent="extra"
            />
          )}
          <Field
            label={`${extraRegionDisplayLabel || '지역'} 말`}
            required
            value={extraWord}
            onChange={setExtraWord}
            accent="extra"
          />
          <TextArea label={`${extraRegionDisplayLabel || '지역'} 예문 (선택)`} value={extraExample} onChange={setExtraExample} accent="extra" />
        </div>
      )}
      <div className="field">
        <span className="field-label">이미지 첨부 (선택)</span>
        <input type="file" accept="image/*" className="field-file" onChange={handleFileChange} disabled={imageProcessing} />
      </div>
      {imageProcessing && <p className="muted small">이미지를 준비하고 있어요...</p>}
      {imageUrl.trim() && (
        <div className="image-preview">
          <img
            src={imageUrl}
            alt="미리보기"
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
          <button type="button" className="btn-ghost danger image-remove" onClick={handleRemoveImage}>이미지 제거</button>
        </div>
      )}
      <p className="form-subtitle">사용 예시 (선택, 글과 음성으로 남길 수 있어요)</p>
      <TextArea label="제주어 예문" value={exJeju} onChange={setExJeju} accent="jeju" />
      <AudioField label="제주어 예문 음성 (선택)" value={audioJeju} onChange={setAudioJeju} accent="jeju" />
      <TextArea label="추자생활언어 예문" value={exChuja} onChange={setExChuja} accent="chuja" />
      <AudioField label="추자생활언어 예문 음성 (선택)" value={audioChuja} onChange={setAudioChuja} accent="chuja" />
      <Field label="닉네임" required value={nickname} onChange={setNickname} placeholder="등록자 닉네임" />
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="btn-primary" onClick={handleSubmit}>{submitLabel}</button>
        {onCancel && (
          <button type="button" className="btn-ghost" onClick={onCancel}>취소</button>
        )}
      </div>
    </div>
  );
}

// ==================== 댓글 ====================
function CommentSection({ comments, defaultNickname, onAdd }) {
  const [nickname, setNickname] = useState(defaultNickname || '');
  const [text, setText] = useState('');

  function submit() {
    if (!text.trim() || !nickname.trim()) return;
    onAdd({ nickname: nickname.trim(), text: text.trim() });
    setText('');
  }

  return (
    <div className="comments">
      <p className="comments-title">댓글 {comments.length}개</p>
      <ul className="comment-list">
        {comments.map((c) => (
          <li key={c.id} className="comment-item">
            <div className="comment-meta">
              <strong>{c.nickname}</strong>
              <span>{fmtDate(c.date)}</span>
            </div>
            <p>{c.text}</p>
          </li>
        ))}
        {comments.length === 0 && <li className="comment-empty">아직 댓글이 없어요. 첫 댓글을 남겨보세요.</li>}
      </ul>
      <div className="comment-form">
        <input className="field-input" placeholder="닉네임" value={nickname} onChange={(e) => setNickname(e.target.value)} />
        <textarea className="field-textarea" placeholder="댓글을 남겨주세요" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        <button type="button" className="btn-secondary" onClick={submit}>댓글 남기기</button>
      </div>
    </div>
  );
}

// ==================== 단어 상세 ====================
function WordDetail({ word, defaultNickname, onAddComment, onSuggestEdit }) {
  const [suggesting, setSuggesting] = useState(false);
  const ex = word.examples || {};
  const audio = word.audio || {};
  const extra = word.extraDialect || null;
  const hasExample = ex.jeju || ex.chuja || audio.jeju || audio.chuja || (extra && extra.example);

  return (
    <div className="word-detail">
      {word.imageUrl && (
        <div className="detail-card detail-image">
          <img
            src={word.imageUrl}
            alt={word.standard}
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        </div>
      )}
      <div className="detail-card">
        <p className="detail-card-title">예문</p>
        <div className="detail-examples">
          {ex.jeju && <p><Chip type="jeju">제주어</Chip>{ex.jeju}</p>}
          {audio.jeju && (
            <p className="detail-audio-row"><Chip type="jeju">제주어 음성</Chip><audio controls src={audio.jeju} /></p>
          )}
          {ex.chuja && <p><Chip type="chuja">추자생활언어</Chip>{ex.chuja}</p>}
          {audio.chuja && (
            <p className="detail-audio-row"><Chip type="chuja">추자생활언어 음성</Chip><audio controls src={audio.chuja} /></p>
          )}
          {extra && extra.example && <p><Chip type="extra">{extra.regionLabel}</Chip>{extra.example}</p>}
          {!hasExample && <p className="muted">등록된 예문이 없어요.</p>}
        </div>
      </div>
      <div className="detail-card detail-meta-card">
        <div className="detail-meta">
          <span>등록 {word.registeredBy} · {fmtDate(word.registeredAt)}</span>
          {word.lastEditedBy && <span>수정 {word.lastEditedBy} · {fmtDate(word.lastEditedAt)}</span>}
        </div>
        {!suggesting ? (
          <button className="btn-ghost" onClick={() => setSuggesting(true)}>수정 제안하기</button>
        ) : (
          <WordForm
            initial={word}
            defaultNickname={defaultNickname}
            submitLabel="수정 제안 보내기"
            onCancel={() => setSuggesting(false)}
            onSubmit={(vals) => {
              onSuggestEdit(vals);
              setSuggesting(false);
            }}
          />
        )}
      </div>
      <div className="detail-card">
        <CommentSection comments={word.comments || []} defaultNickname={defaultNickname} onAdd={(c) => onAddComment(word.id, c)} />
      </div>
    </div>
  );
}

function WordRow({ word, onSelect }) {
  return (
    <div className="word-row">
      <button className="word-row-head" onClick={onSelect} aria-label={`${word.standard} 자세히 보기`}>
        <div className="word-row-main">
          <span className="word-value standard">{word.standard}</span>
          <span className="word-value jeju">{word.jeju}</span>
          <span className="word-value chuja">{word.chuja}</span>
          <span className="word-arrow" aria-hidden="true"><ChevronRight size={18} /></span>
        </div>
        {word.meaning && <p className="word-meaning">{word.meaning}</p>}
      </button>
    </div>
  );
}

// ==================== 단어 상세 페이지 ====================
function WordDetailPage({ word, defaultNickname, onAddComment, onSuggestEdit, onBack }) {
  if (!word) {
    return (
      <section className="view">
        <button className="btn-ghost back-btn" onClick={onBack}>← 목록으로</button>
        <p className="empty-state">낱말을 찾을 수 없어요.</p>
      </section>
    );
  }
  return (
    <section className="view detail-view">
      <button className="btn-ghost back-btn" onClick={onBack}>← 목록으로</button>
      <div className="detail-card detail-header-card">
        <p className="detail-legend">
          <Chip type="standard">표준어</Chip>
          <Chip type="jeju">제주어</Chip>
          <Chip type="chuja">추자생활언어</Chip>
        </p>
        <p className="detail-word-line">
          <span className="standard">{word.standard}</span>
          <span className="sep">·</span>
          <span className="jeju">{word.jeju}</span>
          <span className="sep">·</span>
          <span className="chuja">{word.chuja}</span>
        </p>
        {word.extraDialect && word.extraDialect.word && (
          <p className="detail-extra-line">
            <Chip type="extra">{word.extraDialect.regionLabel}</Chip>
            {word.extraDialect.word}
          </p>
        )}
        {word.meaning && <p className="detail-meaning">{word.meaning}</p>}
      </div>
      <WordDetail word={word} defaultNickname={defaultNickname} onAddComment={onAddComment} onSuggestEdit={onSuggestEdit} />
    </section>
  );
}

// ==================== 헤더 ====================
function Header({ view, setView }) {
  const tabs = [
    ['home', '홈', Home],
    ['dictionary', '사전', BookOpen],
    ['register', '단어 등록', PenSquare],
    ['admin', '관리자', ShieldCheck],
  ];
  return (
    <header className="app-header">
      <p className="brand">추자초 5학년 말바당 사전</p>
      <nav className="nav-tabs">
        {tabs.map(([key, label, Icon]) => {
          const active = view === key || (key === 'dictionary' && view === 'detail');
          return (
            <button key={key} className={`nav-tab ${active ? 'active' : ''}`} onClick={() => setView(key)}>
              <Icon size={16} aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}

// ==================== 홈 ====================
function HomeView({ todayWord, approvedCount, onGoRegister, onViewToday, onShuffleToday }) {
  const ex = todayWord?.examples || {};
  return (
    <section className="view home-view">
      <div className="eyebrow-row">
        <p className="eyebrow"><Sparkles size={16} aria-hidden="true" />오늘의 낱말</p>
        {todayWord && (
          <button type="button" className="shuffle-btn" onClick={onShuffleToday} aria-label="다른 낱말로 바꾸기">
            <Shuffle size={16} />
          </button>
        )}
      </div>
      {todayWord ? (
        <div className="today-card">
          <p className="today-hero">{todayWord.jeju}</p>
          <p className="today-sub">표준어 {todayWord.standard} · 추자생활언어 {todayWord.chuja}</p>
          {todayWord.imageUrl && (
            <div className="today-image">
              <img
                src={todayWord.imageUrl}
                alt={todayWord.jeju}
                onError={(e) => {
                  e.target.style.display = 'none';
                }}
              />
            </div>
          )}
          {ex.jeju && <p className="today-example">"{ex.jeju}"</p>}
          <button className="btn-ghost" onClick={onViewToday}>자세히 보기</button>
        </div>
      ) : (
        <div className="today-card">
          <p>아직 등록된 낱말이 없어요.</p>
          <button className="btn-primary" onClick={onGoRegister}>첫 낱말 등록하기</button>
        </div>
      )}
      <div className="intro">
        <p>
          추자초 5학년 말바당 사전은 표준어, 제주어, 추자생활언어를 나란히 기록하고 나누는 사전이에요. 누구나 새로운 낱말을 등록할 수 있고,
          관리자의 확인을 거쳐 사전에 실려요.
        </p>
        <p className="stat">지금까지 모인 낱말 {approvedCount}개</p>
      </div>
    </section>
  );
}

// ==================== 사전 ====================
function DictionaryView({ words, term, setTerm, sortField, setSortField, sortDir, setSortDir, onSelectWord }) {
  const approved = words.filter((w) => w.status === 'approved');
  const filtered = filterWords(approved, term);
  const sorted = sortWords(filtered, sortField, sortDir);

  return (
    <section className="view">
      <h2 className="view-title">사전</h2>
      <input
        className="search-input"
        placeholder="낱말 검색 (표준어, 제주어, 추자생활언어)"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
      />
      <div className="dict-controls">
        <div className="dict-controls-row">
          <span className="dict-controls-label">정렬 기준</span>
          {[
            ['standard', '표준어'],
            ['jeju', '제주어'],
            ['chuja', '추자생활언어'],
            ['createdAt', '등록순서'],
          ].map(([key, label]) => (
            <button key={key} className={`sort-tab ${sortField === key ? 'active' : ''}`} onClick={() => setSortField(key)}>
              {label}
            </button>
          ))}
        </div>
        <div className="dict-controls-row">
          <span className="dict-controls-label">정렬 방향</span>
          {[
            ['asc', '오름차순'],
            ['desc', '내림차순'],
          ].map(([key, label]) => (
            <button key={key} className={`sort-tab ${sortDir === key ? 'active' : ''}`} onClick={() => setSortDir(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="word-list">
        {sorted.length > 0 && (
          <div className="word-list-header">
            <span>표준어</span>
            <span>제주어</span>
            <span>추자생활언어</span>
            <span />
          </div>
        )}
        {sorted.length === 0 && <p className="empty-state">조건에 맞는 낱말이 없어요.</p>}
        {sorted.map((w) => (
          <WordRow key={w.id} word={w} onSelect={() => onSelectWord(w.id)} />
        ))}
      </div>
    </section>
  );
}

// ==================== 등록 ====================
function RegisterView({ defaultNickname, onSubmit }) {
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <section className="view">
        <h2 className="view-title">새 낱말 등록</h2>
        <div className="notice-card">
          <p>등록 신청이 접수됐어요. 관리자 확인 후 사전에 실려요.</p>
          <button className="btn-ghost" onClick={() => setDone(false)}>다른 낱말 더 등록하기</button>
        </div>
      </section>
    );
  }

  return (
    <section className="view">
      <h2 className="view-title">새 낱말 등록</h2>
      <p className="view-desc">표준어, 제주어, 추자생활언어를 모두 입력해주세요. 등록한 내용은 관리자 확인 후 사전에 반영돼요.</p>
      <WordForm
        defaultNickname={defaultNickname}
        submitLabel="등록 신청하기"
        onSubmit={(vals) => {
          onSubmit(vals);
          setDone(true);
        }}
      />
    </section>
  );
}

// ==================== 관리자 ====================
function AdminView({ words, unlocked, onUnlock, onApprove, onReject, onAdminUpdate, onAdminDelete, onPrepareEdit }) {
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [tab, setTab] = useState('pending');
  const [editingId, setEditingId] = useState(null);
  const [preparingEditId, setPreparingEditId] = useState(null);
  const [query, setQuery] = useState('');
  const [adminNickname, setAdminNickname] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  async function startEdit(id) {
    if (onPrepareEdit) {
      setPreparingEditId(id);
      try {
        await onPrepareEdit(id);
      } finally {
        setPreparingEditId(null);
      }
    }
    setEditingId(id);
  }

  function handlePinSubmit() {
    if (onUnlock(pin)) {
      setPinError('');
    } else {
      setPinError('PIN이 올바르지 않아요.');
    }
  }

  if (!unlocked) {
    return (
      <section className="view">
        <h2 className="view-title">관리자</h2>
        <div className="pin-form">
          <Field label="관리자 PIN" required type="password" value={pin} onChange={setPin} onEnter={handlePinSubmit} />
          {pinError && <p className="form-error">{pinError}</p>}
          <button type="button" className="btn-primary" onClick={handlePinSubmit}>확인</button>
        </div>
        <p className="muted small" style={{ marginTop: '1rem' }}>데모용 PIN이에요. 실제 서비스에서는 별도의 로그인 방식으로 교체해야 해요.</p>
      </section>
    );
  }

  const pending = words.filter((w) => w.status === 'pending');
  const approved = words.filter((w) => w.status === 'approved');
  const filteredApproved = filterWords(approved, query);

  return (
    <section className="view">
      <h2 className="view-title">관리자</h2>
      <div className="admin-tabs">
        <button className={`sort-tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
          승인 대기 ({pending.length})
        </button>
        <button className={`sort-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
          전체 단어 관리 ({approved.length})
        </button>
        <button className={`sort-tab ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>
          통계
        </button>
      </div>

      {tab === 'pending' && (
        <div className="pending-list">
          {pending.length === 0 && <p className="empty-state">대기 중인 항목이 없어요.</p>}
          {pending.map((p) => (
            <div key={p.id} className="pending-item">
              <p className="pending-type">{p.type === 'edit' ? '수정 제안' : '새 낱말'}</p>
              <div className="pending-fields">
                <span><Chip type="standard">표준어</Chip>{p.standard}</span>
                <span><Chip type="jeju">제주어</Chip>{p.jeju}</span>
                <span><Chip type="chuja">추자생활언어</Chip>{p.chuja}</span>
                {p.extraDialect && p.extraDialect.word && (
                  <span><Chip type="extra">{p.extraDialect.regionLabel}</Chip>{p.extraDialect.word}</span>
                )}
              </div>
              {p.imageUrl && (
                <div className="pending-image-preview">
                  <img
                    src={p.imageUrl}
                    alt="첨부 이미지 미리보기"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                </div>
              )}
              <p className="muted small">신청자 {p.registeredBy} · {fmtDate(p.registeredAt)}</p>
              <div className="form-actions">
                <button className="btn-primary" onClick={() => onApprove(p.id)}>승인</button>
                <button className="btn-ghost" onClick={() => onReject(p.id)}>반려</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'all' && (
        <div>
          <input className="search-input" placeholder="낱말 검색" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="word-list">
            {filteredApproved.map((w) => (
              <div key={w.id} className="admin-word-item">
                {editingId === w.id ? (
                  <WordForm
                    initial={w}
                    defaultNickname={adminNickname}
                    submitLabel="저장하기"
                    onCancel={() => setEditingId(null)}
                    onSubmit={(vals) => {
                      setAdminNickname(vals.nickname);
                      onAdminUpdate(w.id, vals);
                      setEditingId(null);
                    }}
                  />
                ) : (
                  <>
                    <div className="pending-fields">
                      <span><Chip type="standard">표준어</Chip>{w.standard}</span>
                      <span><Chip type="jeju">제주어</Chip>{w.jeju}</span>
                      <span><Chip type="chuja">추자생활언어</Chip>{w.chuja}</span>
                      {w.extraDialect && w.extraDialect.word && (
                        <span><Chip type="extra">{w.extraDialect.regionLabel}</Chip>{w.extraDialect.word}</span>
                      )}
                    </div>
                    <div className="form-actions">
                      <button className="btn-ghost" onClick={() => startEdit(w.id)} disabled={preparingEditId === w.id}>
                        {preparingEditId === w.id ? '불러오는 중...' : '수정'}
                      </button>
                      {confirmDeleteId === w.id ? (
                        <span className="confirm-inline">
                          정말 삭제할까요?
                          <button
                            className="btn-ghost danger"
                            onClick={() => {
                              onAdminDelete(w.id);
                              setConfirmDeleteId(null);
                            }}
                          >
                            삭제
                          </button>
                          <button className="btn-ghost" onClick={() => setConfirmDeleteId(null)}>취소</button>
                        </span>
                      ) : (
                        <button className="btn-ghost danger" onClick={() => setConfirmDeleteId(w.id)}>삭제</button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'stats' && <AdminStatsView words={approved} />}
    </section>
  );
}

// ==================== 관리자 통계 ====================
function AdminStatsView({ words }) {
  const countsMap = {};
  words.forEach((w) => {
    const name = w.registeredBy && w.registeredBy.trim() ? w.registeredBy.trim() : '(닉네임 없음)';
    countsMap[name] = (countsMap[name] || 0) + 1;
  });
  const stats = Object.entries(countsMap)
    .map(([nickname, count]) => ({ nickname, count }))
    .sort((a, b) => b.count - a.count || a.nickname.localeCompare(b.nickname, 'ko'));
  const maxCount = stats.length > 0 ? stats[0].count : 0;

  return (
    <div className="stats-list">
      <p className="view-desc">닉네임별로 사전에 실린 낱말 수를 확인할 수 있어요.</p>
      {stats.length === 0 && <p className="empty-state">아직 사전에 실린 낱말이 없어요.</p>}
      {stats.map((s, i) => (
        <div key={s.nickname} className="stats-row">
          <span className="stats-rank">{i + 1}</span>
          <span className="stats-name">{s.nickname}</span>
          <div className="stats-bar-track">
            <div className="stats-bar-fill" style={{ width: `${maxCount ? Math.round((s.count / maxCount) * 100) : 0}%` }} />
          </div>
          <span className="stats-count">{s.count}개</span>
        </div>
      ))}
    </div>
  );
}

// ==================== 메인 앱 ====================
export default function App() {
  const [words, setWords] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('home');
  const [nickname, setNickname] = useState('');
  const [todayWord, setTodayWord] = useState(null);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [dictTerm, setDictTerm] = useState('');
  const [dictSortField, setDictSortField] = useState('standard');
  const [dictSortDir, setDictSortDir] = useState('asc');
  const [selectedWordId, setSelectedWordId] = useState(null);
  const [mediaMap, setMediaMap] = useState({}); // { [wordId]: { imageUrl, audio } }
  const [dbError, setDbError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const list = await dbGetWords();
        setWords(list || []);
      } catch (e) {
        console.error('낱말을 불러오지 못했어요', e);
        setDbError(
          `낱말을 불러오지 못했어요. Firebase 연결 또는 Firestore 보안 규칙을 확인해주세요. (에러: ${e.code || e.message || e})`
        );
        setWords([]);
      }
      try {
        const savedNick = localStorage.getItem(NICK_KEY);
        if (savedNick) setNickname(savedNick);
      } catch (e) {
        // 저장된 닉네임 없음
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const approved = words.filter((w) => w.status === 'approved');
    getOrPickTodayWord(approved).then((picked) => {
      setTodayWord(picked);
      if (picked) ensureMedia(picked.id);
    });
  }, [loaded, words]);

  // 이미지·음성은 낱말마다 따로 저장돼 있어서, 정말 필요할 때(상세 페이지를
  // 열거나 관리자 화면에서 미리보기가 필요할 때)만 그때그때 불러와요.
  async function ensureMedia(id) {
    if (!id || mediaMap[id]) return;
    try {
      const media = await dbGetWordMedia(id);
      setMediaMap((prev) => (prev[id] ? prev : { ...prev, [id]: media }));
    } catch (e) {
      console.error('이미지·음성을 불러오지 못했어요', e);
    }
  }

  function ensureMediaForList(list) {
    list.forEach((w) => ensureMedia(w.id));
  }

  function withMedia(w) {
    return w && mediaMap[w.id] ? { ...w, ...mediaMap[w.id] } : w;
  }

  function rememberNickname(name) {
    setNickname(name);
    try {
      localStorage.setItem(NICK_KEY, name);
    } catch (e) {
      // 저장 실패해도 화면에는 반영된 상태 유지
    }
  }

  async function handleRegisterNew(vals) {
    rememberNickname(vals.nickname);
    const now = new Date().toISOString();
    const newWord = {
      id: uid(),
      type: 'new',
      standard: vals.standard,
      jeju: vals.jeju,
      chuja: vals.chuja,
      meaning: vals.meaning,
      imageUrl: vals.imageUrl,
      examples: vals.examples,
      audio: vals.audio,
      extraDialect: vals.extraDialect || null,
      status: 'pending',
      registeredBy: vals.nickname,
      registeredAt: now,
      lastEditedBy: '',
      lastEditedAt: '',
      comments: [],
    };
    setWords((prev) => [...prev, newWord]);
    try {
      await dbSaveWord(newWord);
    } catch (e) {
      console.error('저장 실패', e);
        setDbError(`저장하지 못했어요. Firebase 연결 또는 Firestore 보안 규칙을 확인해주세요. (에러: ${e.code || e.message || e})`);
    }
  }

  async function handleSuggestEdit(targetId, vals) {
    rememberNickname(vals.nickname);
    const now = new Date().toISOString();
    const editEntry = {
      id: uid(),
      type: 'edit',
      targetId,
      standard: vals.standard,
      jeju: vals.jeju,
      chuja: vals.chuja,
      meaning: vals.meaning,
      imageUrl: vals.imageUrl,
      examples: vals.examples,
      audio: vals.audio,
      extraDialect: vals.extraDialect || null,
      status: 'pending',
      registeredBy: vals.nickname,
      registeredAt: now,
    };
    setWords((prev) => [...prev, editEntry]);
    try {
      await dbSaveWord(editEntry);
    } catch (e) {
      console.error('저장 실패', e);
        setDbError(`저장하지 못했어요. Firebase 연결 또는 Firestore 보안 규칙을 확인해주세요. (에러: ${e.code || e.message || e})`);
    }
  }

  async function handleAddComment(wordId, comment) {
    rememberNickname(comment.nickname);
    const now = new Date().toISOString();
    let updatedWord = null;
    setWords((prev) =>
      prev.map((w) => {
        if (w.id !== wordId) return w;
        updatedWord = {
          ...w,
          comments: [...(w.comments || []), { id: uid(), nickname: comment.nickname, text: comment.text, date: now }],
        };
        return updatedWord;
      })
    );
    if (updatedWord) {
      try {
        await dbSaveWord(updatedWord);
      } catch (e) {
        console.error('저장 실패', e);
        setDbError(`저장하지 못했어요. Firebase 연결 또는 Firestore 보안 규칙을 확인해주세요. (에러: ${e.code || e.message || e})`);
      }
    }
  }

  async function handleApprove(pendingId) {
    const item = words.find((w) => w.id === pendingId);
    if (!item) return;
    const now = new Date().toISOString();
    // 승인 대기 항목 자신의 이미지·음성을 확실히 가져와요. (mediaMap 캐시에 이미
    // 있으면 그대로 쓰고, 없으면(관리자 패널을 막 열어 아직 못 불러왔을 때) 지금 바로 받아와요.)
    let media;
    try {
      media = mediaMap[pendingId] || (await dbGetWordMedia(pendingId));
    } catch (e) {
      media = { imageUrl: '', audio: { jeju: '', chuja: '' } };
    }
    if (item.type === 'edit') {
      let updatedTarget = null;
      setWords((prev) =>
        prev
          .filter((w) => w.id !== pendingId)
          .map((w) => {
            if (w.id !== item.targetId) return w;
            updatedTarget = {
              ...w,
              standard: item.standard,
              jeju: item.jeju,
              chuja: item.chuja,
              meaning: item.meaning,
              imageUrl: media.imageUrl,
              examples: item.examples,
              audio: media.audio,
              extraDialect: item.extraDialect || null,
              lastEditedBy: item.registeredBy,
              lastEditedAt: now,
            };
            return updatedTarget;
          })
      );
      if (updatedTarget) {
        setMediaMap((prev) => ({ ...prev, [item.targetId]: media }));
      }
      try {
        if (updatedTarget) await dbSaveWord(updatedTarget);
        await dbDeleteWord(pendingId);
      } catch (e) {
        console.error('저장 실패', e);
        setDbError(`저장하지 못했어요. Firebase 연결 또는 Firestore 보안 규칙을 확인해주세요. (에러: ${e.code || e.message || e})`);
      }
    } else {
      const updated = { ...item, imageUrl: media.imageUrl, audio: media.audio, status: 'approved' };
      setWords((prev) => prev.map((w) => (w.id === pendingId ? updated : w)));
      try {
        await dbSaveWord(updated);
      } catch (e) {
        console.error('저장 실패', e);
        setDbError(`저장하지 못했어요. Firebase 연결 또는 Firestore 보안 규칙을 확인해주세요. (에러: ${e.code || e.message || e})`);
      }
    }
  }

  async function handleReject(pendingId) {
    setWords((prev) => prev.filter((w) => w.id !== pendingId));
    try {
      await dbDeleteWord(pendingId);
    } catch (e) {
      console.error('저장 실패', e);
        setDbError(`저장하지 못했어요. Firebase 연결 또는 Firestore 보안 규칙을 확인해주세요. (에러: ${e.code || e.message || e})`);
    }
  }

  async function handleAdminUpdate(wordId, vals) {
    const now = new Date().toISOString();
    let updatedWord = null;
    setWords((prev) =>
      prev.map((w) => {
        if (w.id !== wordId) return w;
        updatedWord = {
          ...w,
          standard: vals.standard,
          jeju: vals.jeju,
          chuja: vals.chuja,
          meaning: vals.meaning,
          imageUrl: vals.imageUrl,
          examples: vals.examples,
          audio: vals.audio,
          extraDialect: vals.extraDialect || null,
          lastEditedBy: `관리자(${vals.nickname})`,
          lastEditedAt: now,
        };
        return updatedWord;
      })
    );
    if (updatedWord) {
      try {
        await dbSaveWord(updatedWord);
      } catch (e) {
        console.error('저장 실패', e);
        setDbError(`저장하지 못했어요. Firebase 연결 또는 Firestore 보안 규칙을 확인해주세요. (에러: ${e.code || e.message || e})`);
      }
    }
  }

  async function handleAdminDelete(wordId) {
    setWords((prev) => prev.filter((w) => w.id !== wordId));
    try {
      await dbDeleteWord(wordId);
    } catch (e) {
      console.error('저장 실패', e);
        setDbError(`저장하지 못했어요. Firebase 연결 또는 Firestore 보안 규칙을 확인해주세요. (에러: ${e.code || e.message || e})`);
    }
  }

  function handleUnlock(pin) {
    if (pin === ADMIN_PIN) {
      setAdminUnlocked(true);
      return true;
    }
    return false;
  }

  async function handleShuffleToday() {
    const approved = words.filter((w) => w.status === 'approved');
    if (approved.length === 0) return;
    const pool = approved.length > 1 && todayWord ? approved.filter((w) => w.id !== todayWord.id) : approved;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    setTodayWord(picked);
    ensureMedia(picked.id);
    const dateStr = new Date().toISOString().slice(0, 10);
    try {
      await dbSetToday({ date: dateStr, wordId: picked.id });
    } catch (e) {
      // 저장 실패해도 화면에는 반영된 상태 유지
    }
  }

  function handleSelectWord(id) {
    setSelectedWordId(id);
    setView('detail');
    ensureMedia(id);
  }

  function handleBackToDictionary() {
    setView('dictionary');
  }

  // 관리자 화면(승인 대기 미리보기, 전체 단어 수정)은 이미지·음성이 필요할 수 있어서
  // 관리자 패널을 열면 현재 목록에 필요한 미디어를 미리 불러와둬요.
  useEffect(() => {
    if (view === 'admin' && adminUnlocked) {
      ensureMediaForList(words);
    }
  }, [view, adminUnlocked, words]);

  const approvedCount = words.filter((w) => w.status === 'approved').length;
  const selectedWord = withMedia(words.find((w) => w.id === selectedWordId) || null);
  const todayWordDisplay = withMedia(todayWord);
  const wordsWithMedia = words.map(withMedia);

  return (
    <div className="jejumal-app">
      <GlobalStyle />
      {dbError && (
        <div className="db-error-banner">
          <span>{dbError}</span>
          <button type="button" className="db-error-close" onClick={() => setDbError('')} aria-label="닫기">✕</button>
        </div>
      )}
      <Header view={view} setView={setView} />
      <main className="app-main">
        {!loaded ? (
          <p className="loading">불러오는 중...</p>
        ) : (
          <>
            {view === 'home' && (
              <HomeView
                todayWord={todayWordDisplay}
                approvedCount={approvedCount}
                onGoRegister={() => setView('register')}
                onViewToday={() => todayWord && handleSelectWord(todayWord.id)}
                onShuffleToday={handleShuffleToday}
              />
            )}
            {view === 'dictionary' && (
              <DictionaryView
                words={words}
                term={dictTerm}
                setTerm={setDictTerm}
                sortField={dictSortField}
                setSortField={setDictSortField}
                sortDir={dictSortDir}
                setSortDir={setDictSortDir}
                onSelectWord={handleSelectWord}
              />
            )}
            {view === 'detail' && (
              <WordDetailPage
                word={selectedWord}
                defaultNickname={nickname}
                onAddComment={handleAddComment}
                onSuggestEdit={(vals) => handleSuggestEdit(selectedWordId, vals)}
                onBack={handleBackToDictionary}
              />
            )}
            {view === 'register' && <RegisterView defaultNickname={nickname} onSubmit={handleRegisterNew} />}
            {view === 'admin' && (
              <AdminView
                words={wordsWithMedia}
                unlocked={adminUnlocked}
                onUnlock={handleUnlock}
                onApprove={handleApprove}
                onReject={handleReject}
                onAdminUpdate={handleAdminUpdate}
                onAdminDelete={handleAdminDelete}
                onPrepareEdit={ensureMedia}
              />
            )}
          </>
        )}
      </main>
      <footer className="app-footer">
        <p>이 사전은 이용자들이 함께 채워가는 열린 사전이에요.</p>
      </footer>
    </div>
  );
}
