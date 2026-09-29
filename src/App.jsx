import React, { useState, useEffect, useRef } from 'react';
import { Home, BookOpen, PenSquare, ShieldCheck, Sparkles, ChevronRight, Shuffle, Mic, Square, MessageSquare } from 'lucide-react';
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
} from './firebase';

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
      .today-hero.proverb { font-size: clamp(1.4rem, 5vw, 2.1rem); line-height: 1.4; }
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
      .chip-kind { background: var(--ink-500); color: var(--white); }
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
      .word-row-main.expression-row-main { grid-template-columns: 1fr auto; }
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
      .pending-fields { display: flex; gap: 1rem; flex-wrap: wrap; align-items: center; font-size: 0.92rem; }
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
      .pager { display: flex; align-items: center; justify-content: center; gap: 0.5rem; margin-top: 1.25rem; flex-wrap: wrap; }
      .pager > button {
        border: 2px solid var(--line); background: var(--white); border-radius: 999px;
        padding: 0.4rem 0.9rem; cursor: pointer; color: var(--ink-800); font-weight: 500;
      }
      .pager > button:disabled { opacity: 0.4; cursor: default; }
      .pager-numbers { display: flex; align-items: center; gap: 0.25rem; }
      .pager-number {
        min-width: 2.2rem; height: 2.2rem; border: 2px solid var(--line); background: var(--white);
        border-radius: 999px; cursor: pointer; color: var(--ink-800); font-weight: 500; font-size: 0.85rem;
      }
      .pager-number.active { border-color: var(--accent-500); background: var(--accent-500); color: var(--white); }
      .pager-dots { color: var(--ink-500); font-size: 0.85rem; padding: 0 0.15rem; }
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

function TextArea({ label, value, onChange, accent, required }) {
  return (
    <label className={`field ${accent ? 'accent-' + accent : ''}`}>
      <span className="field-label">
        {label}
        {required && <span className="req">*</span>}
      </span>
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
      nickname: showNickname ? nickname.trim() : undefined,
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
      text: text.trim(),
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
      <TextArea label="문장" required value={text} onChange={setText} accent={accent} />
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

// ==================== 낱말/표현 상세 ====================
function WordDetail({ word, defaultNickname, onAddComment, onSuggestEdit }) {
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
        <CommentSection comments={word.comments || []} defaultNickname={defaultNickname} onAdd={(c) => onAddComment(word.id, c)} />
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
function WordDetailPage({ word, defaultNickname, onAddComment, onSuggestEdit, onBack }) {
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
    ['registerExpression', '표현 등록', MessageSquare],
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
}) {
  const approved = words.filter((w) => w.status === 'approved' && !w.hidden);
  const kindFiltered = kindFilter === 'all' ? approved : approved.filter((w) => itemKind(w) === kindFilter);
  const filtered = filterWords(kindFiltered, term);
  const sorted = sortWords(filtered, sortField, sortDir);
  const { pageItems, totalPages, clampedPage } = paginate(sorted, page, PAGE_SIZE);

  return (
    <section className="view">
      <h2 className="view-title">사전</h2>
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
        {pageItems.map((w) => (
          <WordRow key={w.id} word={w} onSelect={() => onSelectWord(w.id)} />
        ))}
      </div>
      <Pager page={clampedPage} totalPages={totalPages} onChange={setPage} />
    </section>
  );
}

// ==================== 낱말 등록 ====================
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

// ==================== 표현 등록 ====================
function RegisterExpressionView({ defaultNickname, onSubmit }) {
  const [done, setDone] = useState(false);

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
          onSubmit(vals);
          setDone(true);
        }}
      />
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
    onAdd({ jeju: jeju.trim(), meaning: meaning.trim() });
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
    onUpdate(id, { jeju: editJeju.trim(), meaning: editMeaning.trim() });
    setEditingId(null);
  }

  return (
    <div className="pending-list">
      <div className="notice-card">
        <p className="form-subtitle" style={{ marginTop: 0 }}>새 문장 추가</p>
        <TextArea label="문장 (제주어)" required value={jeju} onChange={setJeju} accent="jeju" />
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
              <TextArea label="문장 (제주어)" required value={editJeju} onChange={setEditJeju} accent="jeju" />
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
  // 숨김 처리된 항목도 관리자에게는 계속 보여요. (일반 사전 화면에서만 숨겨져요.)
  const approved = words.filter((w) => w.status === 'approved');
  const kindFilteredApproved = adminKind === 'all' ? approved : approved.filter((w) => itemKind(w) === adminKind);
  const filteredApproved = filterWords(kindFilteredApproved, query);
  const { pageItems, totalPages, clampedPage } = paginate(filteredApproved, adminPage, PAGE_SIZE);

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
              <div key={p.id} className="pending-item">
                <p className="pending-type">{typeLabel}</p>
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

  async function handleRegisterItem(kind, vals) {
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

  function handleRegisterNew(vals) {
    return handleRegisterItem('word', vals);
  }

  function handleRegisterExpression(vals) {
    return handleRegisterItem('expression', vals);
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
              />
            )}
            {view === 'detail' && (
              <WordDetailPage
                word={selectedWord}
                defaultNickname={nickname}
                onAddComment={handleAddComment}
                onSuggestEdit={(vals) => handleSuggestEdit(selectedWordId, itemKind(selectedWord), vals)}
                onBack={handleBackToDictionary}
              />
            )}
            {view === 'register' && <RegisterView defaultNickname={nickname} onSubmit={handleRegisterNew} />}
            {view === 'registerExpression' && (
              <RegisterExpressionView defaultNickname={nickname} onSubmit={handleRegisterExpression} />
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
        <p>이 사전은 이용자들이 함께 채워가는 열린 사전이에요.</p>
      </footer>
    </div>
  );
}
