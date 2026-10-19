import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Home, BookOpen, PenSquare, Sparkles, ChevronRight, Shuffle, Mic, Square, MessageSquare, Trophy, FileDown, Gamepad2 } from 'lucide-react';
import {
  dbGetWords,
  dbGetWordMedia,
  dbSaveWord,
  dbDeleteWord,
  dbGetToday,
  dbSetToday,
  dbGetProverbs,
  dbSaveProverb,
  dbDeleteProverb,
  dbGetTodayProverb,
  dbSetTodayProverb,
  dbGetQuizToday,
  dbSetQuizToday,
  dbGetQuizAttempt,
  dbSaveQuizAttempt,
} from './firebase';
import { kstDateString, buildQuizQuestion, getQuizUserKey, quizAttemptId } from './quiz';
import { makeCardsPdf, downloadBlob } from './cardPdf';
import { AR, normalizeAraea, finalizeAraea } from './jejuInput';

// ==================== 상수 ====================
const NICK_KEY = 'jejumal:nickname'; // 닉네임은 각자 기기(브라우저)에만 저장돼요.
const ADMIN_PIN = '0640'; // 데모용 임시 PIN. 실제 서비스에서는 반드시 별도 로그인으로 교체하세요.
// Firestore 문서 하나는 최대 1MB까지만 저장할 수 있어서, Claude 미리보기 버전보다
// 이미지/음성 용량 제한을 줄여뒀어요. (이미지 1장 + 음성 2개를 합쳐도 1MB를 넘지 않도록)
const MAX_IMAGE_BYTES = 500000; // 이미지 첨부 용량 제한(약 500KB, base64 인코딩 후 기준)
const MAX_IMAGE_DIMENSION = 700; // 첨부 이미지 리사이즈 기준(긴 변, px)
const MAX_AUDIO_BYTES = 200000; // 음성 첨부 용량 제한(약 200KB, base64 인코딩 후 기준)
const MAX_RECORD_MS = 15000; // 녹음 최대 길이(15초)
const PAGE_SIZE = 20; // 사전·관리자 화면 한 페이지에 보여줄 개수
const EXTRA_REGIONS = [
  { key: 'chungcheong', label: '충청도' },
  { key: 'gyeongsang', label: '경상도' },
  { key: 'gangwon', label: '강원도' },
  { key: 'other', label: '기타 지역' },
];
// 낱말/표현을 "수정"할 때(수정 제안, 관리자 수정) 어떤 필드까지 새 값으로
// 덮어쓸지 정해두는 목록이에요. (등록자 닉네임 같은 메타 정보는 건드리지 않아요.)
const CONTENT_FIELDS = {
  word: ['standard', 'jeju', 'chuja', 'meaning', 'examples', 'extraDialect'],
  expression: ['language', 'text', 'meaning'],
};

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

function itemKind(w) {
  return (w && w.kind) || 'word';
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
  return list.filter((w) =>
    [w.standard, w.jeju, w.chuja, w.text, w.meaning].some((v) => (v || '').toLowerCase().includes(t))
  );
}

function paginate(list, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
  const clampedPage = Math.min(Math.max(1, page), totalPages);
  const pageItems = list.slice((clampedPage - 1) * pageSize, clampedPage * pageSize);
  return { pageItems, totalPages, clampedPage };
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

async function getOrPickTodayProverb(proverbs) {
  const dateStr = new Date().toISOString().slice(0, 10);
  try {
    const saved = await dbGetTodayProverb();
    if (saved && saved.date === dateStr) {
      const found = proverbs.find((p) => p.id === saved.proverbId);
      if (found) return found;
    }
  } catch (e) {
    // 저장된 값이 없으면 새로 고른다
  }
  if (proverbs.length === 0) return null;
  const idx = hashString(`proverb-${dateStr}`) % proverbs.length;
  const picked = proverbs[idx];
  try {
    await dbSetTodayProverb({ date: dateStr, proverbId: picked.id });
  } catch (e) {
    // 저장 실패해도 화면에는 표시
  }
  return picked;
}

// ==================== 공통 스타일 ====================
function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap');

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
        font-family: 'Araea', 'Noto Sans KR', sans-serif;
        font-weight: 400;
        color: var(--ink-800);
        background: var(--paper-50);
        min-height: 100vh;
        display: flex;
        flex-direction: column;
      }
      /* 아래아(ᆞ)가 들어간 글자를 제대로 보여주는 글꼴 (옛한글 자모 영역에서만 쓰여요) */
      @font-face { font-family: 'Araea'; font-weight: 400; src: url('/fonts/araea-400.woff') format('woff'); unicode-range: U+1100-11FF, U+A960-A97F, U+D7B0-D7FF; font-display: swap; }
      @font-face { font-family: 'Araea'; font-weight: 700 900; src: url('/fonts/araea-700.woff') format('woff'); unicode-range: U+1100-11FF, U+A960-A97F, U+D7B0-D7FF; font-display: swap; }
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
        font-family: 'Araea', 'Noto Sans KR', sans-serif; font-weight: 700;
        font-size: 1.55rem;
        margin: 0 0 0.9rem;
        color: var(--accent-600);
      }
      .nav-tabs { display: flex; gap: 0.5rem; overflow-x: auto; white-space: nowrap; padding-bottom: 0.15rem; }
      .nav-tab {
        display: inline-flex; align-items: center; gap: 0.35rem;
        background: var(--paper-100); border: none; color: var(--ink-500); opacity: 1;
        padding: 0.5rem 0.95rem; border-radius: 999px; cursor: pointer; font-weight: 700; font-size: 0.9rem;
      }
      .nav-tab.active { background: var(--accent-500); color: var(--white); }
      .app-main { flex: 1; max-width: 760px; width: 100%; margin: 0 auto; padding: 2rem 1.25rem 3rem; }
      .view-title { font-family: 'Araea', 'Noto Sans KR', sans-serif; font-weight: 700; font-size: 1.6rem; margin: 0 0 0.5rem; }
      .view-desc { color: var(--ink-500); margin: 0 0 1.25rem; line-height: 1.6; }
      .eyebrow-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
      .eyebrow { display: flex; align-items: center; gap: 0.35rem; color: var(--accent-600); margin: 0; font-weight: 400; }
      .shuffle-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; border-radius: 999px; border: 2px solid var(--accent-500);
        background: var(--white); color: var(--accent-600); cursor: pointer;
      }
      .shuffle-btn:hover { background: var(--accent-100); }
      .today-card { border: none; border-radius: 24px; padding: 2rem 1.75rem; background: var(--accent-100); box-shadow: 0 6px 0 var(--accent-500); }
      .today-hero {
        font-family: 'Araea', 'Noto Sans KR', sans-serif; font-weight: 700; font-size: clamp(2.2rem, 7vw, 3.2rem);
        color: var(--accent-600); margin: 0 0 0.5rem; line-height: 1.15;
      }
      .today-hero.proverb { font-size: clamp(1.4rem, 5vw, 2.1rem); line-height: 1.4; }
      .today-sub { color: var(--ink-500); margin: 0 0 1rem; font-weight: 400; }
      .today-image img { max-width: 100%; border-radius: 16px; margin-bottom: 1rem; display: block; }
      .today-example {
        font-style: italic; color: var(--ink-800); border-left: 3px solid var(--sea-600);
        padding-left: 0.75rem; margin: 0 0 1rem;
      }
      .intro { margin-top: 1.75rem; line-height: 1.7; }
      .stat { color: var(--sea-700); font-weight: 400; }
      .chip {
        display: inline-block; font-size: 0.75rem; padding: 0.2rem 0.6rem;
        border-radius: 999px; margin-right: 0.4rem; font-weight: 400;
      }
      .chip-standard { background: var(--basalt-900); color: var(--white); }
      .chip-jeju { background: var(--tangerine-500); color: var(--white); }
      .chip-chuja { background: var(--sea-600); color: var(--white); }
      .chip-extra { background: var(--canola-400); color: var(--ink-800); }
      .chip-kind { background: var(--ink-500); color: var(--white); }
      .search-input {
        width: 100%; padding: 0.7rem 1rem; border: 2px solid var(--line);
        border-radius: 16px; background: var(--white); margin-bottom: 0.9rem;
      }
      .sort-tabs, .admin-tabs { display: flex; gap: 0.4rem; margin-bottom: 1rem; flex-wrap: wrap; }
      .sort-tab {
        border: 2px solid var(--line); background: var(--white); padding: 0.45rem 0.9rem;
        border-radius: 999px; cursor: pointer; color: var(--ink-500); font-size: 0.85rem; font-weight: 400;
      }
      .sort-tab.active { border-color: var(--sea-600); color: var(--white); background: var(--sea-600); }
      .dict-controls { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }
      .dict-controls-row { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
      .dict-controls-label { font-size: 0.78rem; color: var(--ink-500); margin-right: 0.2rem; font-weight: 400; }
      .word-list { display: flex; flex-direction: column; gap: 0.6rem; }
      .word-list-header {
        display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 0.5rem;
        padding: 0 0.25rem 0.5rem; font-size: 0.78rem; color: var(--ink-500); font-weight: 400;
      }
      .word-row { border-bottom: none; }
      .word-row-head {
        width: 100%; display: flex; flex-direction: column; gap: 0.3rem;
        background: var(--white); border: 2px solid var(--line); border-radius: 16px;
        padding: 0.85rem 1rem; text-align: left; cursor: pointer; color: var(--ink-800);
      }
      .word-row-head:hover { border-color: var(--accent-500); }
      .word-row-main { display: grid; grid-template-columns: 1fr 1fr 1fr auto; gap: 0.5rem; align-items: center; }
      .word-row-main.expression-row-main { grid-template-columns: 1fr auto; }
      .word-value { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.95rem; font-weight: 700; }
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
        font-family: 'Araea', 'Noto Sans KR', sans-serif; font-weight: 700; font-size: 1.6rem; margin: 0;
      }
      .detail-word-line .sep { color: var(--ink-500); font-size: 1rem; }
      .detail-word-line .standard { color: var(--ink-800); }
      .detail-word-line .jeju { color: var(--tangerine-600); }
      .detail-word-line .chuja { color: var(--sea-700); }
      .detail-extra-line {
        display: flex; align-items: center; gap: 0.5rem; font-size: 0.95rem; color: var(--canola-600);
        font-weight: 400; margin: 0.85rem 0 0; padding-top: 0.85rem; border-top: 1px solid var(--paper-100);
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
      .form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.6rem; }
      .form-grid > * { min-width: 0; }
      @media (max-width: 720px) { .form-grid { grid-template-columns: minmax(0, 1fr); } }
      .form-subtitle { margin: 0.4rem 0 -0.2rem; color: var(--ink-500); font-size: 0.85rem; font-weight: 400; }
      .form-error { color: var(--danger-600); font-size: 0.85rem; margin: 0; font-weight: 400; }
      .form-actions { display: flex; gap: 0.6rem; flex-wrap: wrap; }
      .field { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.85rem; color: var(--ink-500); min-width: 0; }
      .field-input, .field-textarea {
        border: 2px solid var(--line); border-radius: 14px; padding: 0.6rem 0.75rem;
        background: var(--white); color: var(--ink-800); resize: vertical;
        width: 100%; min-width: 0; max-width: 100%; box-sizing: border-box;
      }
      .accent-jeju .field-input, .accent-jeju .field-textarea { border-color: var(--tangerine-500); }
      .accent-chuja .field-input, .accent-chuja .field-textarea { border-color: var(--sea-600); }
      .accent-extra .field-input, .accent-extra .field-textarea { border-color: var(--canola-600); }
      .extra-region-tabs { display: flex; gap: 0.4rem; flex-wrap: wrap; }
      .extra-region-tab {
        border: 2px solid var(--line); background: var(--white); padding: 0.45rem 0.9rem;
        border-radius: 999px; cursor: pointer; color: var(--ink-500); font-size: 0.85rem; font-weight: 400;
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
        border-radius: 999px; padding: 0.6rem 1.3rem; cursor: pointer; font-weight: 400; border: 2px solid transparent;
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
      .comments-title { margin: 0; font-weight: 400; }
      .comment-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.6rem; }
      .comment-item { background: var(--white); border: 2px solid var(--line); border-radius: 14px; padding: 0.6rem 0.75rem; }
      .comment-meta { display: flex; justify-content: space-between; font-size: 0.78rem; color: var(--ink-500); margin-bottom: 0.2rem; }
      .comment-item p { margin: 0; }
      .comment-delete { margin-top: 0.5rem; padding: 0.25rem 0.7rem; font-size: 0.78rem; }
      .comment-empty { color: var(--ink-500); font-size: 0.85rem; }
      .comment-form { display: flex; flex-direction: column; gap: 0.5rem; }
      .notice-card { border: 2px solid var(--line); border-radius: 18px; padding: 1.25rem; background: var(--white); display: flex; flex-direction: column; gap: 0.75rem; }
      .pin-form { display: flex; flex-direction: column; gap: 0.75rem; max-width: 260px; }
      .pending-list { display: flex; flex-direction: column; gap: 0.9rem; }
      .pending-item, .admin-word-item {
        border: 2px solid var(--line); border-radius: 18px; padding: 0.9rem 1rem;
        background: var(--white); display: flex; flex-direction: column; gap: 0.5rem;
      }
      .pending-type { margin: 0; font-size: 0.78rem; color: var(--sea-700); font-weight: 400; }
      .pending-fields { display: flex; gap: 1rem; flex-wrap: wrap; align-items: center; font-size: 0.92rem; }
      .pending-image-preview img { max-width: 140px; border-radius: 12px; display: block; }
      .stats-list { display: flex; flex-direction: column; gap: 0.6rem; }
      .stats-row { display: grid; grid-template-columns: 22px minmax(60px, 110px) 1fr 44px; gap: 0.7rem; align-items: center; }
      .stats-rank { font-weight: 400; color: var(--ink-500); text-align: center; }
      .stats-name { font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .stats-bar-track { background: var(--paper-100); border-radius: 999px; height: 12px; overflow: hidden; }
      .stats-bar-fill { background: var(--accent-500); height: 100%; border-radius: 999px; }
      .stats-count { text-align: right; color: var(--ink-500); font-size: 0.85rem; }
      .confirm-inline { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--ink-500); flex-wrap: wrap; }
      .empty-state { color: var(--ink-500); padding: 1.5rem 0; }
      .loading { color: var(--ink-500); padding: 2rem 0; text-align: center; }
      .pager { display: flex; align-items: center; justify-content: center; gap: 0.5rem; margin-top: 1.25rem; flex-wrap: wrap; }
      .pager > button {
        border: 2px solid var(--line); background: var(--white); border-radius: 999px;
        padding: 0.4rem 0.9rem; cursor: pointer; color: var(--ink-800); font-weight: 400;
      }
      .pager > button:disabled { opacity: 0.4; cursor: default; }
      .pager-numbers { display: flex; align-items: center; gap: 0.25rem; }
      .pager-number {
        min-width: 2.2rem; height: 2.2rem; border: 2px solid var(--line); background: var(--white);
        border-radius: 999px; cursor: pointer; color: var(--ink-800); font-weight: 400; font-size: 0.85rem;
      }
      .pager-number.active { border-color: var(--accent-500); background: var(--accent-500); color: var(--white); }
      .pager-dots { color: var(--ink-500); font-size: 0.85rem; padding: 0 0.15rem; }
      .dup-badge {
        display: inline-flex; align-items: center; gap: 0.3rem; align-self: flex-start;
        background: #FFF0D6; color: #A8560C; border: 2px solid #F5B45A; border-radius: 999px;
        padding: 0.15rem 0.7rem; font-size: 0.8rem; font-weight: 700;
      }
      .pending-item.is-duplicate { border-color: #F5B45A; background: #FFFBF2; }
      .modal-backdrop {
        position: fixed; inset: 0; background: rgba(40, 36, 60, 0.5); z-index: 50;
        display: flex; align-items: center; justify-content: center; padding: 1.25rem;
      }
      .modal-box {
        background: var(--white); border-radius: 20px; padding: 1.5rem 1.4rem; max-width: 380px; width: 100%;
        box-shadow: 0 10px 40px rgba(0,0,0,0.25); display: flex; flex-direction: column; gap: 1.1rem;
      }
      .modal-box p { margin: 0; line-height: 1.6; font-weight: 400; }
      .modal-actions { display: flex; gap: 0.6rem; flex-wrap: wrap; justify-content: flex-end; }
      .card-toolbar {
        display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap;
        background: var(--accent-100); border: 2px solid var(--line); border-radius: 16px;
        padding: 0.6rem 0.8rem; margin-bottom: 0.9rem; font-size: 0.9rem;
      }
      .card-toolbar .spacer { flex: 1; }
      .btn-with-icon { display: inline-flex; align-items: center; gap: 0.4rem; }
      .btn-small { padding: 0.35rem 0.9rem; font-size: 0.85rem; }
      .word-row-select { display: flex; align-items: stretch; gap: 0.5rem; }
      .word-row-select > .word-row { flex: 1; min-width: 0; }
      .row-check {
        display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        width: 2.4rem; background: var(--white); border: 2px solid var(--line); border-radius: 16px; cursor: pointer;
      }
      .row-check input { width: 1.2rem; height: 1.2rem; accent-color: var(--accent-500); cursor: pointer; }
      .row-check.checked { border-color: var(--accent-500); background: var(--accent-100); }
      .detail-actions { display: flex; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 1.1rem; }
      .quiz-card { border: 2px solid var(--line); border-radius: 20px; background: var(--white); padding: 1.3rem 1.2rem; display: flex; flex-direction: column; gap: 0.9rem; }
      .quiz-date { margin: 0; font-size: 0.8rem; color: var(--ink-500); }
      .quiz-prompt { margin: 0; color: var(--ink-500); font-size: 0.9rem; }
      .quiz-word { font-family: 'Araea', 'Noto Sans KR', sans-serif; font-weight: 700; font-size: 2.1rem; margin: 0; color: var(--tangerine-600); word-break: keep-all; }
      .quiz-word.chuja { color: var(--sea-700); }
      .quiz-example { margin: 0; background: var(--paper-100); border-radius: 12px; padding: 0.7rem 0.9rem; line-height: 1.6; }
      .quiz-choices { display: flex; flex-direction: column; gap: 0.6rem; }
      .quiz-choice {
        text-align: left; background: var(--white); border: 2px solid var(--line); border-radius: 14px;
        padding: 0.8rem 1rem; cursor: pointer; font-weight: 400; color: var(--ink-800); font-size: 1.05rem;
      }
      .quiz-choice:hover:not(:disabled) { border-color: var(--accent-500); }
      .quiz-choice:disabled { cursor: default; }
      .quiz-choice.correct { border-color: var(--accent-500); background: var(--accent-100); }
      .quiz-choice.wrong { border-color: var(--danger-border); background: #FDEAEA; }
      .quiz-result { margin: 0; font-weight: 700; font-size: 1.05rem; }
      .quiz-result.ok { color: var(--accent-600); }
      .quiz-result.no { color: var(--danger-600); }
      .quiz-done-note { margin: 0; background: #FFF0D6; border: 2px solid #F5B45A; color: #7A3E06; border-radius: 12px; padding: 0.6rem 0.9rem; font-weight: 700; }
      .footer-secret { margin: 0; cursor: default; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
      .mg-setup { display: flex; flex-direction: column; gap: 1.1rem; }
      .mg-group { display: flex; flex-direction: column; gap: 0.5rem; }
      .mg-label { font-weight: 700; margin: 0; }
      .mg-options { display: flex; gap: 0.5rem; flex-wrap: wrap; }
      .mg-option { border: 2px solid var(--line); background: var(--white); border-radius: 14px; padding: 0.55rem 1rem; cursor: pointer; font-weight: 400; color: var(--ink-800); }
      .mg-option.active { border-color: var(--accent-500); background: var(--accent-500); color: var(--white); }
      .mg-option:disabled { opacity: 0.4; cursor: default; }
      .mg-bar { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-bottom: 0.8rem; }
      .mg-pill { border: 3px solid var(--line); background: var(--white); border-radius: 999px; padding: 0.25rem 0.8rem; font-weight: 700; font-size: 0.9rem; }
      .mg-pill.turn { box-shadow: 0 0 0 3px var(--pc); }
      .mg-time { margin-left: auto; font-weight: 700; font-variant-numeric: tabular-nums; }
      .mg-board { display: grid; grid-template-columns: repeat(6, 1fr); gap: 0.5rem; perspective: 800px; }
      .mg-front .mg-text.len-mid { font-size: 0.92rem; }
      .mg-front .mg-text.len-long { font-size: 0.8rem; }
      .mg-card { position: relative; aspect-ratio: 3 / 4; padding: 0; border: none; background: none; cursor: pointer; }
      .mg-card:disabled { cursor: default; }
      .mg-inner { position: absolute; inset: 0; transform-style: preserve-3d; transition: transform 0.35s; }
      .mg-card.up .mg-inner { transform: rotateY(180deg); }
      .mg-face { position: absolute; inset: 0; backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.25rem; padding: 0.2rem; border: 3px solid var(--white); box-shadow: 0 3px 0 rgba(0,0,0,0.15); }
      .mg-back { background: var(--accent-500); color: var(--white); font-family: 'Araea', 'Noto Sans KR', sans-serif; font-weight: 700; font-size: 1.6rem; background-image: radial-gradient(rgba(255,255,255,0.25) 3px, transparent 4px); background-size: 16px 16px; }
      .mg-front { transform: rotateY(180deg); background: var(--white); border-color: var(--line); word-break: keep-all; text-align: center; line-height: 1.25; }
      .mg-front .mg-kind { font-size: 0.62rem; font-weight: 700; color: var(--white); border-radius: 999px; padding: 0.05rem 0.5rem; }
      .mg-front .mg-text { font-weight: 700; font-size: 1.05rem; }
      .mg-front.is-standard .mg-kind { background: #5B6CC4; } .mg-front.is-standard .mg-text { color: #2C4A8A; }
      .mg-front.is-jeju .mg-kind { background: #FF8A3D; } .mg-front.is-jeju .mg-text { color: #E8731A; }
      .mg-front.owned { border-color: var(--pc); background: var(--pcbg); }
      .mg-owner { position: absolute; top: -6px; right: -6px; background: var(--pc); color: var(--white); border-radius: 999px; font-size: 0.7rem; font-weight: 700; padding: 0.05rem 0.4rem; z-index: 2; }
      /* 스마트폰: 카드 수에 맞춰 열 수를 정하고 카드를 작게 해서, 스크롤을 거의 안 해도 한 화면에 보이게 해요. */
      @media (max-width: 560px) {
        .mg-board { gap: 0.3rem; grid-template-columns: repeat(4, 1fr); }
        .mg-board[data-n="16"] { grid-template-columns: repeat(4, 1fr); }
        .mg-board[data-n="20"] { grid-template-columns: repeat(5, 1fr); }
        .mg-board[data-n="24"] { grid-template-columns: repeat(6, 1fr); }
        .mg-board[data-n="30"] { grid-template-columns: repeat(6, 1fr); }
        .mg-card { aspect-ratio: 1 / 1.15; }
        .mg-face { border-width: 2px; border-radius: 9px; gap: 0.12rem; padding: 0.1rem; }
        .mg-back { font-size: 1.15rem; background-size: 12px 12px; }
        .mg-front .mg-kind { font-size: 0.5rem; padding: 0 0.3rem; }
        .mg-front .mg-text { font-size: 0.78rem; }
        .mg-front .mg-text.len-mid { font-size: 0.62rem; }
        .mg-front .mg-text.len-long { font-size: 0.52rem; }
        .mg-board[data-n="16"] .mg-front .mg-text { font-size: 0.95rem; }
        .mg-board[data-n="16"] .mg-front .mg-text.len-mid { font-size: 0.82rem; }
        .mg-board[data-n="16"] .mg-front .mg-text.len-long { font-size: 0.7rem; }
        .mg-board[data-n="16"] .mg-front .mg-kind { font-size: 0.6rem; }
        .mg-owner { font-size: 0.55rem; top: -4px; right: -4px; }
      }
      .mg-result { border: 3px solid var(--accent-500); border-radius: 18px; background: var(--white); padding: 1rem 1.2rem; margin-bottom: 0.9rem; display: flex; flex-direction: column; gap: 0.6rem; }
      .mg-result h3 { margin: 0; font-family: 'Araea', 'Noto Sans KR', sans-serif; font-weight: 700; font-size: 1.4rem; }
      .mg-result p { margin: 0; }
      .araea-btn { align-self: flex-start; margin-top: 0.35rem; border: 2px solid var(--accent-500); background: var(--white); color: var(--accent-600); border-radius: 999px; padding: 0.2rem 0.8rem; font-size: 0.85rem; font-weight: 700; cursor: pointer; }
      .source-note { margin: 0.5rem 0 0; font-size: 0.72rem; line-height: 1.5; color: var(--ink-500); font-weight: 400; word-break: break-all; }
      .source-note a { color: inherit; text-decoration: underline; }
      .brand-link { cursor: pointer; }
      .register-switch { display: flex; justify-content: center; gap: 0.5rem; margin: 0 auto 1.25rem; padding: 0.35rem; background: var(--accent-100); border-radius: 999px; width: fit-content; max-width: 100%; }
      .register-switch-btn { border: none; background: transparent; color: var(--accent-700); font-weight: 700; font-size: 1.05rem; padding: 0.6rem 1.6rem; border-radius: 999px; cursor: pointer; }
      .register-switch-btn.active { background: var(--accent-500); color: var(--white); box-shadow: 0 2px 0 var(--accent-700); }
      .araea-row { align-self: flex-start; margin-top: 0.35rem; width: 100%; }
      .araea-line { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
      .araea-line .araea-btn { margin-top: 0; }
      .araea-hint { font-size: 0.75rem; color: var(--ink-500); font-weight: 400; }
      .araea-help-btn { width: 1.5rem; height: 1.5rem; border-radius: 50%; border: 2px solid var(--accent-500); background: var(--white); color: var(--accent-600); font-weight: 700; font-size: 0.8rem; line-height: 1; cursor: pointer; padding: 0; }
      .araea-help { margin-top: 0.4rem; background: var(--accent-100); border-radius: 12px; padding: 0.6rem 0.8rem; font-size: 0.82rem; line-height: 1.55; color: var(--ink-800); font-weight: 400; cursor: default; }
      .araea-help p { margin: 0 0 0.25rem; }
      .araea-help p:last-child { margin-bottom: 0; }
      .araea-btn:hover { background: var(--accent-100); }
      .app-footer { text-align: center; padding: 1.25rem; color: var(--ink-500); font-size: 0.8rem; border-top: 3px solid var(--line); }
    `}</style>
  );
}

// ==================== 작은 컴포넌트 ====================
function Chip({ type, children }) {
  return <span className={`chip chip-${type}`}>{children}</span>;
}

// 페이지가 많을 때 번호를 다 늘어놓지 않도록, 처음/끝/현재 주변만 보여주고
// 나머지는 "…"으로 줄여줘요. 예: 1 … 4 5 [6] 7 8 … 20
function getPageNumbers(page, totalPages) {
  const delta = 1;
  const range = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - delta && i <= page + delta)) {
      range.push(i);
    }
  }
  const withDots = [];
  let prev = 0;
  for (const i of range) {
    if (prev) {
      if (i - prev === 2) {
        withDots.push(prev + 1);
      } else if (i - prev > 2) {
        withDots.push('...');
      }
    }
    withDots.push(i);
    prev = i;
  }
  return withDots;
}

function Pager({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  const pageNumbers = getPageNumbers(page, totalPages);
  return (
    <div className="pager">
      <button type="button" onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1}>이전</button>
      <div className="pager-numbers">
        {pageNumbers.map((p, idx) =>
          p === '...' ? (
            <span key={`dots-${idx}`} className="pager-dots">…</span>
          ) : (
            <button
              key={p}
              type="button"
              className={`pager-number ${p === page ? 'active' : ''}`}
              aria-current={p === page ? 'page' : undefined}
              onClick={() => onChange(p)}
            >
              {p}
            </button>
          )
        )}
      </div>
      <button type="button" onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>다음</button>
    </div>
  );
}

// 아래아(ᆞ) 입력 버튼이 붙는 입력칸을 위한 도우미예요. (제주어 낱말·표현 칸에만 써요)
function useAraeaInput(onChange, enabled) {
  const ref = useRef(null);
  const composing = useRef(false);
  const caret = useRef(null);
  useLayoutEffect(() => {
    if (caret.current != null && ref.current) {
      try {
        ref.current.setSelectionRange(caret.current, caret.current);
      } catch (e) {
        // 커서 위치를 못 맞춰도 입력에는 문제없어요
      }
      caret.current = null;
    }
  });
  function apply(el) {
    const r = normalizeAraea(el.value, el.selectionStart == null ? el.value.length : el.selectionStart);
    if (r.text !== el.value) {
      caret.current = r.caret;
      onChange(r.text);
      return true;
    }
    return false;
  }
  const extra = enabled
    ? {
        onCompositionStart: () => { composing.current = true; },
        onCompositionEnd: (e) => { composing.current = false; apply(e.target); },
        onBlur: (e) => { apply(e.target); },
      }
    : {};
  function handleChange(e) {
    if (enabled && !composing.current && apply(e.target)) return;
    onChange(e.target.value);
  }
  function insert() {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const s = el.selectionStart == null ? el.value.length : el.selectionStart;
    const e = el.selectionEnd == null ? s : el.selectionEnd;
    const r = normalizeAraea(el.value.slice(0, s) + AR + el.value.slice(e), s + 1);
    caret.current = r.caret;
    onChange(r.text);
  }
  return { ref, extra, handleChange, insert };
}

function AraeaButton({ onInsert }) {
  const [help, setHelp] = useState(false);
  return (
    <div className="araea-row">
      <div className="araea-line">
        <button
          type="button"
          className="araea-btn"
          onPointerDown={(e) => e.preventDefault()} // 눌러도 입력칸의 포커스(키보드)가 유지되게
          onClick={onInsert}
        >
          ㆍ 아래아 넣기
        </button>
        <button
          type="button"
          className="araea-help-btn"
          aria-expanded={help}
          aria-label="아래아 입력 도움말"
          onPointerDown={(e) => e.preventDefault()}
          onClick={() => setHelp((v) => !v)}
        >
          ?
        </button>
      </div>
      {help && (
        <div className="araea-help" onClick={(e) => e.preventDefault()}>
          아래아 밑에 받침을 넣을 때는 받침 자음을 누르고 커서를 다른 곳으로 옮기세요.
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, required, placeholder, accent, type, onEnter, araea }) {
  const a = useAraeaInput(onChange, !!araea);
  return (
    <label className={`field ${accent ? 'accent-' + accent : ''}`}>
      <span className="field-label">
        {label}
        {required && <span className="req">*</span>}
      </span>
      <input
        ref={a.ref}
        className="field-input"
        type={type || 'text'}
        value={value}
        placeholder={placeholder}
        onChange={a.handleChange}
        {...a.extra}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) onEnter();
        }}
      />
      {araea && <AraeaButton onInsert={a.insert} />}
    </label>
  );
}

function TextArea({ label, value, onChange, accent, required, araea }) {
  const a = useAraeaInput(onChange, !!araea);
  return (
    <label className={`field ${accent ? 'accent-' + accent : ''}`}>
      <span className="field-label">
        {label}
        {required && <span className="req">*</span>}
      </span>
      <textarea ref={a.ref} className="field-textarea" rows={2} value={value} onChange={a.handleChange} {...a.extra} />
      {araea && <AraeaButton onInsert={a.insert} />}
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

// ==================== 낱말 등록/수정 공용 폼 ====================
function WordForm({ initial, defaultNickname, showNickname = true, submitLabel, onSubmit, onCancel }) {
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
    if (showNickname && !nickname.trim()) {
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
      jeju: finalizeAraea(jeju.trim()),
      chuja: chuja.trim(),
      meaning: meaning.trim(),
      imageUrl: imageUrl.trim(),
      examples: { jeju: finalizeAraea(exJeju.trim()), chuja: exChuja.trim() },
      audio: { jeju: audioJeju, chuja: audioChuja },
      extraDialect: extraRegionKey
        ? {
            region: extraRegionKey,
            regionLabel: extraRegionDisplayLabel,
            word: extraWord.trim(),
            example: extraExample.trim(),
          }
        : null,
      nickname: showNickname ? nickname.trim() : undefined,
    });
  }

  return (
    <div className="word-form">
      <div className="form-grid">
        <Field label="표준어" required value={standard} onChange={setStandard} />
        <Field label="제주어" required value={jeju} onChange={setJeju} accent="jeju" araea />
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
      <TextArea label="제주어 예문" value={exJeju} onChange={setExJeju} accent="jeju" araea />
      <AudioField label="제주어 예문 음성 (선택)" value={audioJeju} onChange={setAudioJeju} accent="jeju" />
      <TextArea label="추자생활언어 예문" value={exChuja} onChange={setExChuja} accent="chuja" />
      <AudioField label="추자생활언어 예문 음성 (선택)" value={audioChuja} onChange={setAudioChuja} accent="chuja" />
      {showNickname && <Field label="닉네임" required value={nickname} onChange={setNickname} placeholder="등록자 닉네임" />}
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

// ==================== 표현(제주어 문장 등) 등록/수정 공용 폼 ====================
function ExpressionForm({ initial, defaultNickname, showNickname = true, submitLabel, onSubmit, onCancel }) {
  const [language, setLanguage] = useState(initial?.language || 'jeju');
  const [text, setText] = useState(initial?.text || '');
  const [meaning, setMeaning] = useState(initial?.meaning || '');
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl || '');
  const [imageProcessing, setImageProcessing] = useState(false);
  const [audioMain, setAudioMain] = useState(initial?.audio?.main || '');
  const [nickname, setNickname] = useState(defaultNickname || '');
  const [error, setError] = useState('');

  const accent = language === 'chuja' ? 'chuja' : 'jeju';

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
    if (!text.trim()) {
      setError('문장을 입력해주세요.');
      return;
    }
    if (!meaning.trim()) {
      setError('뜻을 입력해주세요.');
      return;
    }
    if (showNickname && !nickname.trim()) {
      setError('닉네임을 입력해주세요.');
      return;
    }
    setError('');
    onSubmit({
      language,
      text: language === 'jeju' ? finalizeAraea(text.trim()) : text.trim(),
      meaning: meaning.trim(),
      imageUrl: imageUrl.trim(),
      audio: { main: audioMain },
      nickname: showNickname ? nickname.trim() : undefined,
    });
  }

  return (
    <div className="word-form">
      <p className="form-subtitle">어떤 언어의 표현인가요?</p>
      <div className="extra-region-tabs">
        <button type="button" className={`extra-region-tab ${language === 'jeju' ? 'active' : ''}`} onClick={() => setLanguage('jeju')}>제주어</button>
        <button type="button" className={`extra-region-tab ${language === 'chuja' ? 'active' : ''}`} onClick={() => setLanguage('chuja')}>추자생활언어</button>
      </div>
      <TextArea label="문장" required value={text} onChange={setText} accent={accent} araea={language === 'jeju'} />
      <TextArea label="뜻" required value={meaning} onChange={setMeaning} />
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
      <AudioField label="문장 음성 (선택)" value={audioMain} onChange={setAudioMain} accent={accent} />
      {showNickname && <Field label="닉네임" required value={nickname} onChange={setNickname} placeholder="등록자 닉네임" />}
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
function CommentSection({ comments, isAdmin, onAdd, onDelete }) {
  // 닉네임은 기억해두지 않고 매번 새로 입력하게 해요.
  const [nickname, setNickname] = useState('');
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
            {isAdmin && (
              <button type="button" className="btn-ghost danger comment-delete" onClick={() => onDelete(c.id)}>삭제</button>
            )}
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

// ==================== 낱말/표현 상세 ====================
function WordDetail({ word, isAdmin, onAddComment, onDeleteComment, onSuggestEdit }) {
  const [suggesting, setSuggesting] = useState(false);
  const kind = itemKind(word);
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
            alt={word.standard || word.text}
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        </div>
      )}
      {kind === 'word' && (
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
      )}
      {kind === 'expression' && audio.main && (
        <div className="detail-card">
          <p className="detail-card-title">음성</p>
          <div className="detail-audio-row"><audio controls src={audio.main} /></div>
        </div>
      )}
      <div className="detail-card detail-meta-card">
        <div className="detail-meta">
          <span>등록 {word.registeredBy} · {fmtDate(word.registeredAt)}</span>
          {word.lastEditedBy && <span>수정 {word.lastEditedBy} · {fmtDate(word.lastEditedAt)}</span>}
        </div>
        {!suggesting ? (
          <button className="btn-ghost" onClick={() => setSuggesting(true)}>수정 제안하기</button>
        ) : kind === 'expression' ? (
          <ExpressionForm
            initial={word}
            showNickname={false}
            submitLabel="수정 제안 보내기"
            onCancel={() => setSuggesting(false)}
            onSubmit={(vals) => {
              onSuggestEdit(vals);
              setSuggesting(false);
            }}
          />
        ) : (
          <WordForm
            initial={word}
            showNickname={false}
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
        <CommentSection
          comments={word.comments || []}
          isAdmin={isAdmin}
          onAdd={(c) => onAddComment(word.id, c)}
          onDelete={(commentId) => onDeleteComment(word.id, commentId)}
        />
      </div>
    </div>
  );
}

function WordRow({ word, onSelect }) {
  const kind = itemKind(word);
  if (kind === 'expression') {
    return (
      <div className="word-row">
        <button className="word-row-head" onClick={onSelect} aria-label="표현 자세히 보기">
          <div className="word-row-main expression-row-main">
            <span className={`word-value ${word.language === 'chuja' ? 'chuja' : 'jeju'}`}>{word.text}</span>
            <span className="word-arrow" aria-hidden="true"><ChevronRight size={18} /></span>
          </div>
          {word.meaning && <p className="word-meaning">{word.meaning}</p>}
        </button>
      </div>
    );
  }
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

// ==================== 낱말/표현 상세 페이지 ====================
function WordDetailPage({ word, isAdmin, onAddComment, onDeleteComment, onSuggestEdit, onBack, onMakeCard, cardBusy }) {
  if (!word) {
    return (
      <section className="view">
        <button className="btn-ghost back-btn" onClick={onBack}>← 목록으로</button>
        <p className="empty-state">낱말을 찾을 수 없어요.</p>
      </section>
    );
  }
  const kind = itemKind(word);
  return (
    <section className="view detail-view">
      <button className="btn-ghost back-btn" onClick={onBack}>← 목록으로</button>
      <div className="detail-card detail-header-card">
        {kind === 'expression' ? (
          <>
            <p className="detail-legend">
              <Chip type="kind">표현</Chip>
              <Chip type={word.language === 'chuja' ? 'chuja' : 'jeju'}>{word.language === 'chuja' ? '추자생활언어' : '제주어'}</Chip>
            </p>
            <p className="detail-word-line">
              <span className={word.language === 'chuja' ? 'chuja' : 'jeju'}>{word.text}</span>
            </p>
            {word.meaning && <p className="detail-meaning">{word.meaning}</p>}
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
      <div className="detail-actions">
        <button type="button" className="btn-secondary btn-with-icon" onClick={onMakeCard} disabled={!!cardBusy}>
          <FileDown size={16} aria-hidden="true" />
          {cardBusy || '낱말/표현 카드 만들기 (PDF)'}
        </button>
      </div>
      <WordDetail
        word={word}
        isAdmin={isAdmin}
        onAddComment={onAddComment}
        onDeleteComment={onDeleteComment}
        onSuggestEdit={onSuggestEdit}
      />
    </section>
  );
}

// ==================== 헤더 ====================
function Header({ view, setView }) {
  const goHome = () => { setView('home'); if (typeof window !== 'undefined') window.scrollTo(0, 0); };
  const tabs = [
    ['home', '홈', Home],
    ['dictionary', '사전 둘러보기', BookOpen],
    ['register', '사전 등록', PenSquare],
    ['quiz', '오늘의 퀴즈', Trophy],
    ['memory', '짝맞추기', Gamepad2],
  ];
  return (
    <header className="app-header">
      <p
        className="brand brand-link"
        role="link"
        tabIndex={0}
        onClick={goHome}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } }}
      >
        추자초 5학년 말바당 사전
      </p>
      <nav className="nav-tabs">
        {tabs.map(([key, label, Icon]) => {
          const active = view === key || (key === 'dictionary' && view === 'detail') || (key === 'register' && view === 'registerExpression');
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
function HomeView({ todayWord, approvedCount, todayProverb, onShuffleProverb, onGoRegister, onViewToday, onShuffleToday }) {
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

      <div className="eyebrow-row" style={{ marginTop: '1.75rem' }}>
        <p className="eyebrow"><Sparkles size={16} aria-hidden="true" />오늘의 문장</p>
        {todayProverb && (
          <button type="button" className="shuffle-btn" onClick={onShuffleProverb} aria-label="다른 문장으로 바꾸기">
            <Shuffle size={16} />
          </button>
        )}
      </div>
      {todayProverb ? (
        <div className="today-card">
          <p className="today-hero proverb">{todayProverb.jeju}</p>
          <p className="today-sub">{todayProverb.meaning}</p>
        </div>
      ) : (
        <div className="today-card">
          <p>아직 등록된 문장이 없어요.</p>
        </div>
      )}
      {todayProverb && (
        <p className="source-note">
          출처 -[제주특별자치도], [제주특별자치도-문화/역사/체육-제주어(
          <a href="https://www.jeju.go.kr/culture/dialect/proverb/proverbDictionary.htm?indexP=" target="_blank" rel="noopener noreferrer">
            https://www.jeju.go.kr/culture/dialect/proverb/proverbDictionary.htm?indexP=
          </a>
          )]
        </p>
      )}

      <div className="intro">
        <p>
          추자초 5학년 말바당 사전은 표준어, 제주어, 추자생활언어를 나란히 기록하고 나누는 사전이에요. 누구나 새로운 낱말과 표현을 등록할 수 있고,
          관리자의 확인을 거쳐 사전에 실려요.
        </p>
        <p className="stat">지금까지 모인 낱말 {approvedCount}개</p>
      </div>
    </section>
  );
}

// ==================== 사전 ====================
function DictionaryView({
  words,
  term,
  setTerm,
  sortField,
  setSortField,
  sortDir,
  setSortDir,
  kindFilter,
  setKindFilter,
  page,
  setPage,
  onSelectWord,
  selectedIds,
  onToggleSelect,
  onSelectMany,
  onClearSelection,
  onMakeCards,
  cardBusy,
}) {
  const approved = words.filter((w) => w.status === 'approved' && !w.hidden);
  const kindFiltered = kindFilter === 'all' ? approved : approved.filter((w) => itemKind(w) === kindFilter);
  const filtered = filterWords(kindFiltered, term);
  const sorted = sortWords(filtered, sortField, sortDir);
  const { pageItems, totalPages, clampedPage } = paginate(sorted, page, PAGE_SIZE);
  const validSelected = selectedIds.filter((id) => approved.some((w) => w.id === id));
  const allPageSelected = pageItems.length > 0 && pageItems.every((w) => selectedIds.includes(w.id));

  return (
    <section className="view">
      <h2 className="view-title">사전 둘러보기</h2>
      <div className="card-toolbar">
        <span>
          카드로 만들 낱말/표현을 체크하세요. <strong>{validSelected.length}개 선택</strong>
        </span>
        <span className="spacer" />
        <button
          type="button"
          className="btn-ghost btn-small"
          onClick={() => onSelectMany(pageItems.map((w) => w.id), !allPageSelected)}
          disabled={pageItems.length === 0}
        >
          {allPageSelected ? '이 페이지 선택 해제' : '이 페이지 모두 선택'}
        </button>
        <button type="button" className="btn-ghost btn-small" onClick={onClearSelection} disabled={validSelected.length === 0}>
          선택 비우기
        </button>
        <button
          type="button"
          className="btn-secondary btn-small btn-with-icon"
          onClick={() => onMakeCards(validSelected)}
          disabled={validSelected.length === 0 || !!cardBusy}
        >
          <FileDown size={15} aria-hidden="true" />
          {cardBusy || '선택한 카드 PDF 만들기'}
        </button>
      </div>
      <div className="dict-controls-row" style={{ marginBottom: '0.75rem' }}>
        <span className="dict-controls-label">보기</span>
        {[
          ['all', '전체 함께보기'],
          ['word', '낱말만 모아보기'],
          ['expression', '표현만 모아보기'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`sort-tab ${kindFilter === key ? 'active' : ''}`}
            onClick={() => {
              setKindFilter(key);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <input
        className="search-input"
        placeholder="검색 (표준어, 제주어, 추자생활언어, 표현)"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setPage(1);
        }}
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
            <button
              key={key}
              className={`sort-tab ${sortField === key ? 'active' : ''}`}
              onClick={() => {
                setSortField(key);
                setPage(1);
              }}
            >
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
            <button
              key={key}
              className={`sort-tab ${sortDir === key ? 'active' : ''}`}
              onClick={() => {
                setSortDir(key);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="word-list">
        {kindFilter === 'word' && pageItems.length > 0 && (
          <div className="word-list-header">
            <span>표준어</span>
            <span>제주어</span>
            <span>추자생활언어</span>
            <span />
          </div>
        )}
        {sorted.length === 0 && <p className="empty-state">조건에 맞는 낱말이 없어요.</p>}
        {pageItems.map((w) => {
          const checked = selectedIds.includes(w.id);
          return (
            <div key={w.id} className="word-row-select">
              <label className={`row-check ${checked ? 'checked' : ''}`} title="카드 만들기에 포함">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleSelect(w.id)}
                  aria-label="카드 만들기에 포함"
                />
              </label>
              <WordRow word={w} onSelect={() => onSelectWord(w.id)} />
            </div>
          );
        })}
      </div>
      <Pager page={clampedPage} totalPages={totalPages} onChange={setPage} />
    </section>
  );
}

// ==================== 낱말 등록 ====================
// 이미 사전에 있는 낱말/표현을 또 신청하려 할 때 한 번 더 물어보는 확인 창이에요.
function DuplicateConfirm({ onIgnore, onCancel }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="중복 등록 확인">
      <div className="modal-box">
        <p>똑같은 낱말/표현이 이미 사전에 등록되어 있습니다. 등록 신청을 계속 하시겠습니까?</p>
        <div className="modal-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>취소</button>
          <button type="button" className="btn-primary" onClick={onIgnore}>무시하고 신청하기</button>
        </div>
      </div>
    </div>
  );
}

// ==================== 사전 등록 (낱말/표현 선택) ====================
function RegisterHub({ children }) {
  const [kind, setKind] = useState('word');
  return (
    <>
      <div className="register-switch" role="tablist" aria-label="등록할 종류">
        {[
          ['word', '낱말 등록'],
          ['expression', '표현 등록'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={kind === key}
            className={`register-switch-btn ${kind === key ? 'active' : ''}`}
            onClick={() => setKind(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {children(kind)}
    </>
  );
}

function RegisterView({ defaultNickname, onSubmit, checkDuplicate }) {
  const [done, setDone] = useState(false);
  const [pendingVals, setPendingVals] = useState(null);

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
          if (checkDuplicate && checkDuplicate(vals)) {
            setPendingVals(vals);
            return;
          }
          onSubmit(vals, false);
          setDone(true);
        }}
      />
      {pendingVals && (
        <DuplicateConfirm
          onCancel={() => setPendingVals(null)}
          onIgnore={() => {
            onSubmit(pendingVals, true);
            setPendingVals(null);
            setDone(true);
          }}
        />
      )}
    </section>
  );
}

// ==================== 표현 등록 ====================
function RegisterExpressionView({ defaultNickname, onSubmit, checkDuplicate }) {
  const [done, setDone] = useState(false);
  const [pendingVals, setPendingVals] = useState(null);

  if (done) {
    return (
      <section className="view">
        <h2 className="view-title">새 표현 등록</h2>
        <div className="notice-card">
          <p>등록 신청이 접수됐어요. 관리자 확인 후 사전에 실려요.</p>
          <button className="btn-ghost" onClick={() => setDone(false)}>다른 표현 더 등록하기</button>
        </div>
      </section>
    );
  }

  return (
    <section className="view">
      <h2 className="view-title">새 표현 등록</h2>
      <p className="view-desc">제주어 또는 추자생활언어 중 하나를 선택해서 문장과 뜻을 입력해주세요. 등록한 내용은 관리자 확인 후 사전에 반영돼요.</p>
      <ExpressionForm
        defaultNickname={defaultNickname}
        submitLabel="등록 신청하기"
        onSubmit={(vals) => {
          if (checkDuplicate && checkDuplicate(vals)) {
            setPendingVals(vals);
            return;
          }
          onSubmit(vals, false);
          setDone(true);
        }}
      />
      {pendingVals && (
        <DuplicateConfirm
          onCancel={() => setPendingVals(null)}
          onIgnore={() => {
            onSubmit(pendingVals, true);
            setPendingVals(null);
            setDone(true);
          }}
        />
      )}
    </section>
  );
}

// ==================== 관리자: 오늘의 문장 관리 ====================
function AdminProverbsView({ proverbs, onAdd, onUpdate, onDelete }) {
  const [jeju, setJeju] = useState('');
  const [meaning, setMeaning] = useState('');
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editJeju, setEditJeju] = useState('');
  const [editMeaning, setEditMeaning] = useState('');

  function submitNew() {
    if (!jeju.trim() || !meaning.trim()) {
      setError('문장과 뜻을 모두 입력해주세요.');
      return;
    }
    setError('');
    onAdd({ jeju: finalizeAraea(jeju).trim(), meaning: meaning.trim() });
    setJeju('');
    setMeaning('');
  }

  function startEdit(p) {
    setEditingId(p.id);
    setEditJeju(p.jeju);
    setEditMeaning(p.meaning);
  }

  function saveEdit(id) {
    if (!editJeju.trim() || !editMeaning.trim()) return;
    onUpdate(id, { jeju: finalizeAraea(editJeju).trim(), meaning: editMeaning.trim() });
    setEditingId(null);
  }

  return (
    <div className="pending-list">
      <div className="notice-card">
        <p className="form-subtitle" style={{ marginTop: 0 }}>새 문장 추가</p>
        <TextArea label="문장 (제주어)" required value={jeju} onChange={setJeju} accent="jeju" araea />
        <TextArea label="뜻" required value={meaning} onChange={setMeaning} />
        {error && <p className="form-error">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn-primary" onClick={submitNew}>추가하기</button>
        </div>
      </div>
      {proverbs.length === 0 && <p className="empty-state">등록된 문장이 없어요.</p>}
      {proverbs.map((p) => (
        <div key={p.id} className="pending-item">
          {editingId === p.id ? (
            <>
              <TextArea label="문장 (제주어)" required value={editJeju} onChange={setEditJeju} accent="jeju" araea />
              <TextArea label="뜻" required value={editMeaning} onChange={setEditMeaning} />
              <div className="form-actions">
                <button type="button" className="btn-primary" onClick={() => saveEdit(p.id)}>저장하기</button>
                <button type="button" className="btn-ghost" onClick={() => setEditingId(null)}>취소</button>
              </div>
            </>
          ) : (
            <>
              <p className="detail-word-line" style={{ fontSize: '1.1rem' }}>{p.jeju}</p>
              <p className="muted">{p.meaning}</p>
              <div className="form-actions">
                <button type="button" className="btn-ghost" onClick={() => startEdit(p)}>수정</button>
                <button type="button" className="btn-ghost danger" onClick={() => onDelete(p.id)}>삭제</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ==================== 관리자 ====================
function AdminView({
  words,
  proverbs,
  unlocked,
  onUnlock,
  onApprove,
  onReject,
  onAdminUpdate,
  onAdminDelete,
  onPrepareEdit,
  onToggleHidden,
  onAddProverb,
  onUpdateProverb,
  onDeleteProverb,
}) {
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [tab, setTab] = useState('pending');
  const [editingId, setEditingId] = useState(null);
  const [preparingEditId, setPreparingEditId] = useState(null);
  const [query, setQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [adminKind, setAdminKind] = useState('all');
  const [adminPage, setAdminPage] = useState(1);
  const [adminSort, setAdminSort] = useState('registered'); // registered(등록순) | standard(표준어 가나다순)

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
      </section>
    );
  }

  const pending = words.filter((w) => w.status === 'pending');
  // 숨김 처리된 항목도 관리자에게는 계속 보여요. (일반 사전 화면에서만 숨겨져요.)
  const approved = words.filter((w) => w.status === 'approved');
  const kindFilteredApproved = adminKind === 'all' ? approved : approved.filter((w) => itemKind(w) === adminKind);
  const filteredApproved = filterWords(kindFilteredApproved, query);
  const sortedApproved = [...filteredApproved].sort((a, b) => {
    if (adminSort === 'standard') {
      // 낱말은 표준어, 표현은 문장 기준 (표현은 표준어가 없어요)
      const c = (a.standard || a.text || '').localeCompare(b.standard || b.text || '', 'ko');
      if (c !== 0) return c;
    }
    // 등록순 = 최신순 (가나다순에서 표준어가 같으면 이쪽도 최신이 먼저)
    return new Date(b.registeredAt || 0).getTime() - new Date(a.registeredAt || 0).getTime();
  });
  const { pageItems, totalPages, clampedPage } = paginate(sortedApproved, adminPage, PAGE_SIZE);

  return (
    <section className="view">
      <h2 className="view-title">관리자</h2>
      <div className="admin-tabs">
        <button className={`sort-tab ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}>
          승인 대기 ({pending.length})
        </button>
        <button className={`sort-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
          전체 콘텐츠 관리 ({approved.length})
        </button>
        <button className={`sort-tab ${tab === 'proverbs' ? 'active' : ''}`} onClick={() => setTab('proverbs')}>
          문장 관리 ({proverbs.length})
        </button>
        <button className={`sort-tab ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>
          통계
        </button>
      </div>

      {tab === 'pending' && (
        <div className="pending-list">
          {pending.length === 0 && <p className="empty-state">대기 중인 항목이 없어요.</p>}
          {pending.map((p) => {
            const kind = itemKind(p);
            const typeLabel =
              kind === 'expression'
                ? p.type === 'edit' ? '표현 수정 제안' : '새 표현'
                : p.type === 'edit' ? '낱말 수정 제안' : '새 낱말';
            return (
              <div key={p.id} className={`pending-item ${p.duplicate ? 'is-duplicate' : ''}`}>
                <p className="pending-type">{typeLabel}</p>
                {p.duplicate && p.type !== 'edit' && (
                  <p className="dup-badge">⚠ 중복된 {kind === 'expression' ? '표현' : '낱말'} — 이미 사전에 있는데 무시하고 신청했어요</p>
                )}
                <div className="pending-fields">
                  {kind === 'expression' ? (
                    <>
                      <span><Chip type={p.language === 'chuja' ? 'chuja' : 'jeju'}>{p.language === 'chuja' ? '추자생활언어' : '제주어'}</Chip>{p.text}</span>
                      {p.meaning && <span className="muted small">{p.meaning}</span>}
                    </>
                  ) : (
                    <>
                      <span><Chip type="standard">표준어</Chip>{p.standard}</span>
                      <span><Chip type="jeju">제주어</Chip>{p.jeju}</span>
                      <span><Chip type="chuja">추자생활언어</Chip>{p.chuja}</span>
                      {p.extraDialect && p.extraDialect.word && (
                        <span><Chip type="extra">{p.extraDialect.regionLabel}</Chip>{p.extraDialect.word}</span>
                      )}
                    </>
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
            );
          })}
        </div>
      )}

      {tab === 'all' && (
        <div>
          <div className="dict-controls-row" style={{ marginBottom: '0.6rem' }}>
            {[
              ['all', '전체'],
              ['word', '낱말'],
              ['expression', '표현'],
            ].map(([key, label]) => (
              <button
                key={key}
                className={`sort-tab ${adminKind === key ? 'active' : ''}`}
                onClick={() => {
                  setAdminKind(key);
                  setAdminPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="dict-controls-row" style={{ marginBottom: '0.6rem' }}>
            <span className="dict-controls-label">정렬</span>
            {[
              ['registered', '등록순(최신순)'],
              ['standard', '표준어 가나다순'],
            ].map(([key, label]) => (
              <button
                key={key}
                className={`sort-tab ${adminSort === key ? 'active' : ''}`}
                onClick={() => {
                  setAdminSort(key);
                  setAdminPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            className="search-input"
            placeholder="검색"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setAdminPage(1);
            }}
          />
          <div className="word-list">
            {pageItems.map((w) => {
              const kind = itemKind(w);
              return (
                <div key={w.id} className="admin-word-item">
                  {editingId === w.id ? (
                    kind === 'expression' ? (
                      <ExpressionForm
                        initial={w}
                        showNickname={false}
                        submitLabel="저장하기"
                        onCancel={() => setEditingId(null)}
                        onSubmit={(vals) => {
                          onAdminUpdate(w.id, kind, vals);
                          setEditingId(null);
                        }}
                      />
                    ) : (
                      <WordForm
                        initial={w}
                        showNickname={false}
                        submitLabel="저장하기"
                        onCancel={() => setEditingId(null)}
                        onSubmit={(vals) => {
                          onAdminUpdate(w.id, kind, vals);
                          setEditingId(null);
                        }}
                      />
                    )
                  ) : (
                    <>
                      <div className="pending-fields">
                        {w.hidden && <Chip type="kind">숨김</Chip>}
                        {kind === 'expression' ? (
                          <>
                            <span><Chip type={w.language === 'chuja' ? 'chuja' : 'jeju'}>{w.language === 'chuja' ? '추자생활언어' : '제주어'}</Chip>{w.text}</span>
                          </>
                        ) : (
                          <>
                            <span><Chip type="standard">표준어</Chip>{w.standard}</span>
                            <span><Chip type="jeju">제주어</Chip>{w.jeju}</span>
                            <span><Chip type="chuja">추자생활언어</Chip>{w.chuja}</span>
                            {w.extraDialect && w.extraDialect.word && (
                              <span><Chip type="extra">{w.extraDialect.regionLabel}</Chip>{w.extraDialect.word}</span>
                            )}
                          </>
                        )}
                      </div>
                      <div className="form-actions">
                        <button className="btn-ghost" onClick={() => startEdit(w.id)} disabled={preparingEditId === w.id}>
                          {preparingEditId === w.id ? '불러오는 중...' : '수정'}
                        </button>
                        <button className="btn-ghost" onClick={() => onToggleHidden(w.id)}>
                          {w.hidden ? '숨김 해제' : '숨기기'}
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
              );
            })}
          </div>
          <Pager page={clampedPage} totalPages={totalPages} onChange={setAdminPage} />
        </div>
      )}

      {tab === 'proverbs' && (
        <AdminProverbsView proverbs={proverbs} onAdd={onAddProverb} onUpdate={onUpdateProverb} onDelete={onDeleteProverb} />
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
      <p className="view-desc">닉네임별로 사전에 실린 낱말·표현 수를 확인할 수 있어요.</p>
      {stats.length === 0 && <p className="empty-state">아직 사전에 실린 항목이 없어요.</p>}
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

// ==================== 오늘의 퀴즈 ====================
function QuizView({ words, onGoWord, onError }) {
  const [dateStr, setDateStr] = useState(() => kstDateString());
  const [state, setState] = useState({ status: 'loading' }); // loading | none | ready | done
  const [saving, setSaving] = useState(false);

  // 대한민국 시간으로 0시가 지나면 새 문제로 바꿔요. (화면을 열어둔 채로 자정을 넘겨도 적용)
  useEffect(() => {
    const timer = setInterval(() => {
      const now = kstDateString();
      setDateStr((prev) => (prev === now ? prev : now));
    }, 20000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      let question = null;
      try {
        const saved = await dbGetQuizToday();
        if (saved && saved.date === dateStr && Array.isArray(saved.choices)) question = saved;
      } catch (e) {
        // 읽기 실패 → 아래에서 직접 만들어요 (같은 날이면 누가 만들어도 똑같은 문제가 나와요)
      }
      if (!question) {
        question = buildQuizQuestion(words, dateStr);
        if (question) {
          try {
            await dbSetQuizToday(question);
          } catch (e) {
            // 저장 실패해도 문제는 보여줘요
          }
        }
      }
      if (cancelled) return;
      if (!question) {
        setState({ status: 'none' });
        return;
      }
      let attempt = null;
      try {
        const key = await getQuizUserKey();
        attempt = await dbGetQuizAttempt(quizAttemptId(dateStr, key));
      } catch (e) {
        // 참여 기록을 못 읽으면 처음 푸는 것으로 처리해요
      }
      if (cancelled) return;
      if (attempt && attempt.date === dateStr) {
        setState({ status: 'done', question, choice: attempt.choice, already: true });
      } else {
        setState({ status: 'ready', question });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateStr]);

  async function pick(choice) {
    if (state.status !== 'ready' || saving) return;
    const question = state.question;
    setSaving(true);
    setState({ status: 'done', question, choice, already: false });
    try {
      const key = await getQuizUserKey();
      await dbSaveQuizAttempt(quizAttemptId(dateStr, key), {
        date: dateStr,
        choice,
        correct: choice === question.answer,
        at: new Date().toISOString(),
      });
    } catch (e) {
      console.error('퀴즈 기록 저장 실패', e);
      if (onError) onError(`퀴즈 참여 기록을 저장하지 못했어요. (에러: ${e.code || e.message || e})`);
    }
    setSaving(false);
  }

  const q = state.question;
  const isDone = state.status === 'done';
  const targetWord = q ? words.find((w) => w.id === q.wordId && w.status === 'approved' && !w.hidden) : null;

  return (
    <section className="view">
      <h2 className="view-title">오늘의 퀴즈</h2>
      <p className="view-desc">하루에 한 문제! 매일 밤 0시(한국 시간)에 새 문제로 바뀌어요.</p>
      {state.status === 'loading' && <p className="loading">문제를 불러오는 중...</p>}
      {state.status === 'none' && (
        <div className="notice-card">
          <p>퀴즈를 만들기에 사전에 낱말이 아직 부족해요. 낱말이 더 모이면 퀴즈가 열려요!</p>
        </div>
      )}
      {(state.status === 'ready' || isDone) && q && (
        <div className="quiz-card">
          <p className="quiz-date">{q.date}</p>
          {isDone && state.already && <p className="quiz-done-note">이미 오늘의 퀴즈를 완료하였습니다.</p>}
          <p className="quiz-prompt">
            <Chip type={q.dialectLabel === '추자생활언어' ? 'chuja' : 'jeju'}>{q.dialectLabel}</Chip> 이 말은 표준어로 무엇일까요?
          </p>
          <p className={`quiz-word ${q.dialectLabel === '추자생활언어' ? 'chuja' : ''}`}>{q.dialectText}</p>
          {q.example && <p className="quiz-example">예문: {q.example}</p>}
          <div className="quiz-choices">
            {q.choices.map((c) => {
              let cls = 'quiz-choice';
              if (isDone) {
                if (c === q.answer) cls += ' correct';
                else if (c === state.choice) cls += ' wrong';
              }
              return (
                <button key={c} type="button" className={cls} disabled={isDone || saving} onClick={() => pick(c)}>
                  {c}
                  {isDone && c === q.answer && ' ✓'}
                </button>
              );
            })}
          </div>
          {isDone && (
            <>
              <p className={`quiz-result ${state.choice === q.answer ? 'ok' : 'no'}`}>
                {state.choice === q.answer ? '정답이에요! 🎉' : `아쉬워요. 정답은 "${q.answer}"예요.`}
              </p>
              {targetWord ? (
                <div className="form-actions">
                  <button type="button" className="btn-primary" onClick={() => onGoWord(q.wordId)}>사전에서 찾아보기</button>
                </div>
              ) : (
                <p className="muted small">이 낱말은 지금 사전에서 볼 수 없어요.</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ==================== 카드 짝맞추기 ====================
const MEMORY_PAIR_OPTIONS = [8, 10, 12, 15]; // 짝 수 (카드는 그 두 배: 16, 20, 24, 30장)
const PLAYER_COLORS = [
  { main: '#3B7DDD', bg: '#E3EEFF' },
  { main: '#E5487F', bg: '#FFE4EE' },
  { main: '#E0A400', bg: '#FFF3CC' },
  { main: '#8E5BD9', bg: '#EFE5FF' },
];

function shuffleArray(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 짝맞추기에 쓸 수 있는 낱말: 사전에 실린(숨기지 않은) 낱말 중 표준어·제주어가 모두 있고
// 두 글자가 서로 다른 것. 같은 글자가 카드에 두 번 나오지 않도록 겹치는 건 하나만 써요.
function memoryEligibleWords(words) {
  const seen = new Set();
  const out = [];
  words
    .filter((w) => w.status === 'approved' && !w.hidden && itemKind(w) === 'word')
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .forEach((w) => {
      const std = (w.standard || '').trim();
      const jeju = (w.jeju || '').trim();
      if (!std || !jeju || std === jeju || seen.has(std) || seen.has(jeju)) return;
      seen.add(std);
      seen.add(jeju);
      out.push({ id: w.id, standard: std, jeju });
    });
  return out;
}

function fmtTime(ms) {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function MemoryGameView({ words }) {
  const [players, setPlayers] = useState(1);
  const [pairCount, setPairCount] = useState(8);
  const [game, setGame] = useState(null); // null이면 설정 화면
  const [now, setNow] = useState(Date.now());
  const lockRef = useRef(false);
  const timerRef = useRef(null);

  const eligible = memoryEligibleWords(words);
  const maxPairs = eligible.length;
  const selectablePairs = MEMORY_PAIR_OPTIONS.filter((n) => n <= maxPairs);
  const effectivePairs = selectablePairs.includes(pairCount) ? pairCount : selectablePairs[0] || 0;

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  // 걸린 시간 표시를 위해 게임 중에는 시계를 계속 갱신해요.
  useEffect(() => {
    if (!game || !game.startAt || game.endAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [game && game.startAt, game && game.endAt]);

  function startGame() {
    if (!effectivePairs) return;
    const chosen = shuffleArray(eligible).slice(0, effectivePairs);
    const cards = [];
    chosen.forEach((w) => {
      cards.push({ pairId: w.id, side: 'standard', text: w.standard });
      cards.push({ pairId: w.id, side: 'jeju', text: w.jeju });
    });
    lockRef.current = false;
    clearTimeout(timerRef.current);
    setGame({
      cards: shuffleArray(cards),
      players,
      flipped: [],
      owner: {},
      current: 0,
      scores: Array(players).fill(0),
      tries: 0,
      startAt: null,
      endAt: null,
    });
  }

  function backToSetup() {
    clearTimeout(timerRef.current);
    lockRef.current = false;
    setGame(null);
  }

  function flip(i) {
    if (!game || lockRef.current || game.endAt) return;
    if (game.owner[i] !== undefined || game.flipped.includes(i)) return;
    const startAt = game.startAt || Date.now();
    const flipped = [...game.flipped, i];
    if (flipped.length < 2) {
      setGame({ ...game, flipped, startAt });
      return;
    }
    const [a, b] = flipped;
    const ok = game.cards[a].pairId === game.cards[b].pairId && game.cards[a].side !== game.cards[b].side;
    lockRef.current = true;
    setGame({ ...game, flipped, startAt, tries: game.tries + 1 });
    timerRef.current = setTimeout(
      () => {
        setGame((prev) => {
          if (!prev) return prev;
          if (ok) {
            const owner = { ...prev.owner, [a]: prev.current, [b]: prev.current };
            const scores = prev.scores.map((s, idx) => (idx === prev.current ? s + 1 : s));
            const done = Object.keys(owner).length === prev.cards.length;
            // 맞추면 같은 사람이 계속해요.
            return { ...prev, flipped: [], owner, scores, endAt: done ? Date.now() : null };
          }
          // 틀리면 다음 사람 차례예요. (1명이면 그대로)
          return { ...prev, flipped: [], current: (prev.current + 1) % prev.players };
        });
        lockRef.current = false;
      },
      ok ? 700 : 1100
    );
  }

  if (!game) {
    return (
      <section className="view">
        <h2 className="view-title">카드 짝맞추기</h2>
        <p className="view-desc">표준어 카드와 제주어 카드를 뒤집어서 같은 뜻의 짝을 찾아보세요!</p>
        {maxPairs < MEMORY_PAIR_OPTIONS[0] ? (
          <div className="notice-card">
            <p>짝맞추기를 하려면 사전에 표준어와 제주어가 모두 있는 낱말이 {MEMORY_PAIR_OPTIONS[0]}개 이상 필요해요. (지금 {maxPairs}개)</p>
          </div>
        ) : (
          <div className="mg-setup">
            <div className="mg-group">
              <p className="mg-label">몇 명이 할까요?</p>
              <div className="mg-options">
                {[1, 2, 3, 4].map((n) => (
                  <button key={n} type="button" className={`mg-option ${players === n ? 'active' : ''}`} onClick={() => setPlayers(n)}>
                    {n}명
                  </button>
                ))}
              </div>
              <p className="muted small">
                {players === 1 ? '혼자 하면 모든 짝을 맞출 때까지 걸린 시간을 재요.' : '짝을 맞추면 계속하고, 틀리면 다음 사람 차례예요. 짝을 가장 많이 맞춘 사람이 이겨요.'}
              </p>
            </div>
            <div className="mg-group">
              <p className="mg-label">낱말을 몇 개 쓸까요?</p>
              <div className="mg-options">
                {MEMORY_PAIR_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`mg-option ${effectivePairs === n ? 'active' : ''}`}
                    disabled={n > maxPairs}
                    onClick={() => setPairCount(n)}
                  >
                    {n}개 ({n * 2}장)
                  </button>
                ))}
              </div>
            </div>
            <div className="form-actions">
              <button type="button" className="btn-primary" onClick={startGame}>게임 시작!</button>
            </div>
          </div>
        )}
      </section>
    );
  }

  const totalPairs = game.cards.length / 2;
  const single = game.players === 1;
  const finished = !!game.endAt;
  const elapsed = game.startAt ? (game.endAt || now) - game.startAt : 0;
  const best = Math.max(...game.scores);
  const winners = game.scores.map((sc, idx) => (sc === best ? idx : -1)).filter((idx) => idx >= 0);

  return (
    <section className="view">
      <h2 className="view-title">카드 짝맞추기</h2>
      <div className="mg-bar">
        {single ? (
          <span className="mg-pill">맞춘 짝 {game.scores[0]} / {totalPairs}</span>
        ) : (
          game.scores.map((sc, idx) => (
            <span
              key={idx}
              className={`mg-pill ${!finished && game.current === idx ? 'turn' : ''}`}
              style={{ '--pc': PLAYER_COLORS[idx].main, borderColor: PLAYER_COLORS[idx].main, background: PLAYER_COLORS[idx].bg, color: PLAYER_COLORS[idx].main }}
            >
              {idx + 1}P {sc}쌍{!finished && game.current === idx ? ' ◀ 차례' : ''}
            </span>
          ))
        )}
        <span className="mg-time">{single ? `⏱ ${fmtTime(elapsed)}` : `남은 짝 ${totalPairs - game.scores.reduce((a, b) => a + b, 0)}`}</span>
      </div>

      {finished && (
        <div className="mg-result">
          {single ? (
            <>
              <h3>🎉 모든 짝을 맞췄어요!</h3>
              <p>걸린 시간 <strong>{fmtTime(elapsed)}</strong> · 뒤집어 본 횟수 {game.tries}번</p>
            </>
          ) : (
            <>
              <h3>
                🏆 {winners.length === game.players
                  ? '모두 같은 점수예요! 무승부!'
                  : winners.length > 1
                    ? `공동 우승: ${winners.map((w) => `${w + 1}P`).join(', ')}`
                    : `${winners[0] + 1}P 우승!`}
              </h3>
              <p>{game.scores.map((sc, idx) => `${idx + 1}P ${sc}쌍`).join(' · ')}</p>
            </>
          )}
          <div className="form-actions">
            <button type="button" className="btn-primary" onClick={startGame}>다시 하기</button>
            <button type="button" className="btn-ghost" onClick={backToSetup}>설정 바꾸기</button>
          </div>
        </div>
      )}

      <div className="mg-board" data-n={game.cards.length}>
        {game.cards.map((c, i) => {
          const owner = game.owner[i];
          const up = game.flipped.includes(i) || owner !== undefined;
          const col = owner !== undefined ? PLAYER_COLORS[owner] : null;
          const lenCls = c.text.length > 6 ? 'len-long' : c.text.length > 4 ? 'len-mid' : '';
          return (
            <button
              key={i}
              type="button"
              className={`mg-card ${up ? 'up' : ''}`}
              disabled={up || finished}
              onClick={() => flip(i)}
              aria-label={up ? c.text : '뒤집지 않은 카드'}
              style={col ? { '--pc': col.main, '--pcbg': col.bg } : undefined}
            >
              {col && !single && <span className="mg-owner">{owner + 1}P</span>}
              <div className="mg-inner">
                <div className="mg-face mg-back">?</div>
                <div className={`mg-face mg-front is-${c.side} ${col ? 'owned' : ''}`}>
                  <span className="mg-kind">{c.side === 'standard' ? '표준어' : '제주어'}</span>
                  <span className={`mg-text ${lenCls}`}>{c.text}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {!finished && (
        <div className="form-actions" style={{ marginTop: '1rem' }}>
          <button type="button" className="btn-ghost" onClick={backToSetup}>그만하기</button>
        </div>
      )}
    </section>
  );
}

// ==================== 메인 앱 ====================
export default function App() {
  const [words, setWords] = useState([]);
  const [proverbs, setProverbs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState('home');
  const [nickname, setNickname] = useState('');
  const [todayWord, setTodayWord] = useState(null);
  const [todayProverb, setTodayProverb] = useState(null);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [dictTerm, setDictTerm] = useState('');
  const [dictSortField, setDictSortField] = useState('standard');
  const [dictSortDir, setDictSortDir] = useState('asc');
  const [dictKind, setDictKind] = useState('all');
  const [dictPage, setDictPage] = useState(1);
  const [selectedWordId, setSelectedWordId] = useState(null);
  const [mediaMap, setMediaMap] = useState({}); // { [wordId]: { imageUrl, audio } }
  const [dbError, setDbError] = useState('');
  const [selectedIds, setSelectedIds] = useState([]); // 카드 만들기용으로 체크한 낱말/표현 id
  const [cardBusy, setCardBusy] = useState(''); // 카드 PDF를 만드는 동안 보여줄 진행 문구

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
        const list = await dbGetProverbs();
        setProverbs(list || []);
      } catch (e) {
        console.error('문장을 불러오지 못했어요', e);
        setProverbs([]);
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
    const approved = words.filter((w) => w.status === 'approved' && !w.hidden && itemKind(w) === 'word');
    getOrPickTodayWord(approved).then((picked) => {
      setTodayWord(picked);
      if (picked) ensureMedia(picked.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, words]);

  useEffect(() => {
    if (!loaded) return;
    getOrPickTodayProverb(proverbs).then(setTodayProverb);
  }, [loaded, proverbs]);

  // 이미지·음성은 낱말/표현마다 따로 저장돼 있어서, 정말 필요할 때(상세 페이지를
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

  // 같은 글자의 표준어(낱말) / 같은 문장(표현)이 이미 사전에 실려 있는지 확인해요.
  // (숨김 처리된 항목과 승인 대기 중인 항목은 "사전에 등록된 것"으로 보지 않아요.)
  function checkDuplicate(kind, vals) {
    const norm = (v) => String(v || '').replace(/\s+/g, ' ').trim();
    const key = kind === 'expression' ? 'text' : 'standard';
    const target = norm(vals[key]);
    if (!target) return false;
    return words.some(
      (w) => w.status === 'approved' && !w.hidden && itemKind(w) === kind && norm(w[key]) === target
    );
  }

  async function handleRegisterItem(kind, vals, duplicate) {
    rememberNickname(vals.nickname);
    const now = new Date().toISOString();
    const fields = CONTENT_FIELDS[kind] || CONTENT_FIELDS.word;
    const content = {};
    fields.forEach((f) => {
      content[f] = vals[f];
    });
    const newItem = {
      id: uid(),
      kind,
      type: 'new',
      ...content,
      imageUrl: vals.imageUrl || '',
      audio: vals.audio || {},
      status: 'pending',
      hidden: false,
      duplicate: !!duplicate,
      registeredBy: vals.nickname,
      registeredAt: now,
      lastEditedBy: '',
      lastEditedAt: '',
      comments: [],
    };
    setWords((prev) => [...prev, newItem]);
    try {
      await dbSaveWord(newItem);
    } catch (e) {
      console.error('저장 실패', e);
      setDbError(`저장하지 못했어요. Firebase 연결 또는 Firestore 보안 규칙을 확인해주세요. (에러: ${e.code || e.message || e})`);
    }
  }

  function handleRegisterNew(vals, duplicate) {
    return handleRegisterItem('word', vals, duplicate);
  }

  function handleRegisterExpression(vals, duplicate) {
    return handleRegisterItem('expression', vals, duplicate);
  }

  async function handleSuggestEdit(targetId, kind, vals) {
    const now = new Date().toISOString();
    const fields = CONTENT_FIELDS[kind] || CONTENT_FIELDS.word;
    const content = {};
    fields.forEach((f) => {
      content[f] = vals[f];
    });
    // 수정 제안에서는 닉네임을 다시 묻지 않고, 이 기기에 저장된 닉네임을 그대로 써요.
    const editEntry = {
      id: uid(),
      kind,
      type: 'edit',
      targetId,
      ...content,
      imageUrl: vals.imageUrl || '',
      audio: vals.audio || {},
      status: 'pending',
      registeredBy: nickname || '익명',
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

  // 관리자만 사용하는 기능이에요. (WordDetailPage에서 isAdmin일 때만 삭제 버튼이 보여요.)
  async function handleDeleteComment(wordId, commentId) {
    let updatedWord = null;
    setWords((prev) =>
      prev.map((w) => {
        if (w.id !== wordId) return w;
        updatedWord = { ...w, comments: (w.comments || []).filter((c) => c.id !== commentId) };
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
      media = { imageUrl: '', audio: {} };
    }
    if (item.type === 'edit') {
      const kind = itemKind(item);
      const fields = CONTENT_FIELDS[kind] || CONTENT_FIELDS.word;
      let updatedTarget = null;
      setWords((prev) =>
        prev
          .filter((w) => w.id !== pendingId)
          .map((w) => {
            if (w.id !== item.targetId) return w;
            const contentUpdate = {};
            fields.forEach((f) => {
              contentUpdate[f] = item[f];
            });
            updatedTarget = {
              ...w,
              ...contentUpdate,
              imageUrl: media.imageUrl,
              audio: media.audio,
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

  async function handleAdminUpdate(wordId, kind, vals) {
    const now = new Date().toISOString();
    const fields = CONTENT_FIELDS[kind] || CONTENT_FIELDS.word;
    const content = {};
    fields.forEach((f) => {
      content[f] = vals[f];
    });
    let updatedWord = null;
    setWords((prev) =>
      prev.map((w) => {
        if (w.id !== wordId) return w;
        updatedWord = {
          ...w,
          ...content,
          imageUrl: vals.imageUrl || '',
          audio: vals.audio || {},
          lastEditedBy: '관리자',
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

  async function handleAdminToggleHidden(wordId) {
    let updatedWord = null;
    setWords((prev) =>
      prev.map((w) => {
        if (w.id !== wordId) return w;
        updatedWord = { ...w, hidden: !w.hidden };
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

  async function handleAddProverb(vals) {
    const now = new Date().toISOString();
    const p = { id: uid(), jeju: vals.jeju, meaning: vals.meaning, createdAt: now };
    setProverbs((prev) => [...prev, p]);
    try {
      await dbSaveProverb(p);
    } catch (e) {
      console.error('저장 실패', e);
      setDbError(`문장을 저장하지 못했어요. (에러: ${e.code || e.message || e})`);
    }
  }

  async function handleUpdateProverb(id, vals) {
    let updated = null;
    setProverbs((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        updated = { ...p, jeju: vals.jeju, meaning: vals.meaning };
        return updated;
      })
    );
    if (updated) {
      try {
        await dbSaveProverb(updated);
      } catch (e) {
        console.error('저장 실패', e);
        setDbError(`문장을 저장하지 못했어요. (에러: ${e.code || e.message || e})`);
      }
    }
  }

  async function handleDeleteProverb(id) {
    setProverbs((prev) => prev.filter((p) => p.id !== id));
    try {
      await dbDeleteProverb(id);
    } catch (e) {
      console.error('저장 실패', e);
      setDbError(`문장을 삭제하지 못했어요. (에러: ${e.code || e.message || e})`);
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
    const approved = words.filter((w) => w.status === 'approved' && !w.hidden && itemKind(w) === 'word');
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

  async function handleShuffleProverb() {
    if (proverbs.length === 0) return;
    const pool = proverbs.length > 1 && todayProverb ? proverbs.filter((p) => p.id !== todayProverb.id) : proverbs;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    setTodayProverb(picked);
    const dateStr = new Date().toISOString().slice(0, 10);
    try {
      await dbSetTodayProverb({ date: dateStr, proverbId: picked.id });
    } catch (e) {
      // 저장 실패해도 화면에는 반영된 상태 유지
    }
  }

  function toggleSelect(id) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function selectMany(ids, on) {
    setSelectedIds((prev) => {
      const rest = prev.filter((x) => !ids.includes(x));
      return on ? [...rest, ...ids] : rest;
    });
  }

  // 낱말/표현 카드를 PDF로 만들어 내려받아요. (이미지는 필요할 때 그때그때 불러와요.)
  async function handleMakeCards(ids) {
    if (cardBusy) return;
    const list = ids.map((id) => words.find((w) => w.id === id)).filter(Boolean);
    if (list.length === 0) return;
    setCardBusy(`만드는 중... (0/${list.length})`);
    try {
      const items = [];
      for (const w of list) {
        let media = mediaMap[w.id];
        if (!media) {
          try {
            media = await dbGetWordMedia(w.id);
            const loaded = media;
            setMediaMap((prev) => (prev[w.id] ? prev : { ...prev, [w.id]: loaded }));
          } catch (e) {
            media = { imageUrl: '' };
          }
        }
        items.push({ ...w, imageUrl: media.imageUrl || '' });
      }
      const blob = await makeCardsPdf(items, (done, total) => setCardBusy(`만드는 중... (${done}/${total})`));
      const first = itemKind(list[0]) === 'expression' ? list[0].text : list[0].standard;
      const safe = String(first || '카드').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 20);
      downloadBlob(blob, list.length === 1 ? `말바당카드_${safe}.pdf` : `말바당카드_${list.length}장.pdf`);
    } catch (e) {
      console.error('카드 만들기 실패', e);
      setDbError(`카드를 만들지 못했어요. (에러: ${e.message || e})`);
    } finally {
      setCardBusy('');
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

  // 관리자 화면(승인 대기 미리보기, 전체 콘텐츠 수정)은 이미지·음성이 필요할 수 있어서
  // 관리자 패널을 열면 현재 목록에 필요한 미디어를 미리 불러와둬요.
  useEffect(() => {
    if (view === 'admin' && adminUnlocked) {
      ensureMediaForList(words);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, adminUnlocked, words]);

  const approvedCount = words.filter((w) => w.status === 'approved' && !w.hidden && itemKind(w) === 'word').length;
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
                todayProverb={todayProverb}
                onShuffleProverb={handleShuffleProverb}
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
                kindFilter={dictKind}
                setKindFilter={setDictKind}
                page={dictPage}
                setPage={setDictPage}
                onSelectWord={handleSelectWord}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onSelectMany={selectMany}
                onClearSelection={() => setSelectedIds([])}
                onMakeCards={handleMakeCards}
                cardBusy={cardBusy}
              />
            )}
            {view === 'detail' && (
              <WordDetailPage
                word={selectedWord}
                isAdmin={adminUnlocked}
                onAddComment={handleAddComment}
                onDeleteComment={handleDeleteComment}
                onSuggestEdit={(vals) => handleSuggestEdit(selectedWordId, itemKind(selectedWord), vals)}
                onBack={handleBackToDictionary}
                onMakeCard={() => handleMakeCards([selectedWordId])}
                cardBusy={cardBusy}
              />
            )}
            {view === 'memory' && <MemoryGameView words={words} />}
            {view === 'quiz' && <QuizView words={words} onGoWord={handleSelectWord} onError={setDbError} />}
            {/* 등록 화면은 예전에 입력했던 닉네임을 자동으로 채우지 않고, 매번 새로 입력하게 해요. */}
            {view === 'register' && (
              <RegisterHub>
                {(kind) =>
                  kind === 'word' ? (
                    <RegisterView defaultNickname="" onSubmit={handleRegisterNew} checkDuplicate={(vals) => checkDuplicate('word', vals)} />
                  ) : (
                    <RegisterExpressionView
                      defaultNickname=""
                      onSubmit={handleRegisterExpression}
                      checkDuplicate={(vals) => checkDuplicate('expression', vals)}
                    />
                  )
                }
              </RegisterHub>
            )}
            {view === 'admin' && (
              <AdminView
                words={wordsWithMedia}
                proverbs={proverbs}
                unlocked={adminUnlocked}
                onUnlock={handleUnlock}
                onApprove={handleApprove}
                onReject={handleReject}
                onAdminUpdate={handleAdminUpdate}
                onAdminDelete={handleAdminDelete}
                onPrepareEdit={ensureMedia}
                onToggleHidden={handleAdminToggleHidden}
                onAddProverb={handleAddProverb}
                onUpdateProverb={handleUpdateProverb}
                onDeleteProverb={handleDeleteProverb}
              />
            )}
          </>
        )}
      </main>
      <footer className="app-footer">
        {/* 관리자 페이지로 들어가는 숨은 입구예요. 링크처럼 보이지 않게 일부러 일반 글처럼 꾸몄어요. */}
        <p
          className="footer-secret"
          onClick={() => {
            setView('admin');
            window.scrollTo(0, 0);
          }}
        >
          이 사전은 이용자들이 함께 채워가는 열린 사전이에요.
        </p>
      </footer>
    </div>
  );
}
