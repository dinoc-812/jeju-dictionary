// ==================== 낱말/표현 카드 PDF 만들기 ====================
// 카드 한 장 = 가로 64mm × 세로 89mm.
//  - 한 장만 만들면: 카드 크기(64×89mm) 그대로의 1쪽짜리 PDF
//  - 여러 장이면: A4 한 쪽에 잘리지 않게 최대한 많이(가로 3 × 세로 3 = 9장) 배치
// 카드 그림은 브라우저의 캔버스로 그리고(그래서 한글 글꼴이 그대로 나와요),
// PDF 파일은 외부 라이브러리 없이 직접 조립해요.

export const CARD_W_MM = 64;
export const CARD_H_MM = 89;
const A4_W_MM = 210;
const A4_H_MM = 297;

// 카드 그림 해상도: 300dpi (1mm ≈ 11.81px)
const PX_PER_MM = 300 / 25.4;
const CARD_W = Math.round(CARD_W_MM * PX_PER_MM); // 756
const CARD_H = Math.round(CARD_H_MM * PX_PER_MM); // 1051

const FONT_BODY = '"Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
const FONT_TITLE = FONT_BODY; // 낱말·큰 글씨는 굵은 Noto Sans KR(900)로 통통하게 써요. (머리띠 제목만 Jua)
const FONT_BRAND = `"Jua", ${FONT_BODY}`;

const COLOR = {
  paper: '#E8F7E4', // 카드 바탕(연한 초록)
  white: '#FFFFFF',
  ink: '#2E3B2F',
  inkSoft: '#6B7F6C',
  line: '#A9DDA5', // 점선·테두리(연초록)
  accent: '#3FA34D', // 머리띠·테두리 초록
  accentDark: '#2E7D3A',
  imgTop: '#D4F3CE',
  imgBottom: '#9ADB93',
  standard: '#2C4A8A',
  standardChip: '#5B6CC4',
  jeju: '#E8731A',
  jejuChip: '#FF8A3D',
  chuja: '#0F7F74',
  chujaChip: '#14A89A',
  bubble: 'rgba(255,255,255,0.65)',
};

// ---------- A4 배치 계산 ----------
// 가로로 3장(192mm), 세로로 3장(267mm)이 들어가는 게 최대예요. (4번째 줄/열은 A4에 안 들어감)
export function a4Layout() {
  const cols = Math.floor(A4_W_MM / CARD_W_MM);
  const rows = Math.floor(A4_H_MM / CARD_H_MM);
  const x0 = (A4_W_MM - cols * CARD_W_MM) / 2;
  const y0 = (A4_H_MM - rows * CARD_H_MM) / 2;
  return { cols, rows, perPage: cols * rows, x0, y0 };
}

// ---------- 그리기 도구 ----------
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

// 글을 칸 너비에 맞춰 줄바꿈해요. 어절(띄어쓰기) 단위로 나누고, 한 어절이 너무 길면 글자 단위로 잘라요.
function wrapLines(ctx, text, maxWidth, maxLines) {
  const lines = [];
  String(text || '')
    .split(/\r?\n/)
    .forEach((para) => {
      const words = para.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        lines.push('');
        return;
      }
      let line = '';
      words.forEach((word) => {
        const trial = line ? `${line} ${word}` : word;
        if (ctx.measureText(trial).width <= maxWidth) {
          line = trial;
          return;
        }
        if (line) lines.push(line);
        line = '';
        let chunk = '';
        Array.from(word).forEach((ch) => {
          if (ctx.measureText(chunk + ch).width <= maxWidth) {
            chunk += ch;
          } else {
            lines.push(chunk);
            chunk = ch;
          }
        });
        line = chunk;
      });
      if (line) lines.push(line);
    });
  if (maxLines && lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    let last = cut[maxLines - 1];
    while (last.length > 0 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
    cut[maxLines - 1] = `${last}…`;
    return cut;
  }
  return lines;
}

// 글씨가 한 줄 안에 들어가도록 크기를 줄여가며 맞춰요.
function fitFontSize(ctx, text, fontFamily, weight, startSize, minSize, maxWidth) {
  let size = startSize;
  while (size > minSize) {
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    if (ctx.measureText(text).width <= maxWidth) return size;
    size -= 2;
  }
  return minSize;
}

function drawChip(ctx, x, y, w, h, label, bg, fontSize, dry) {
  if (!dry) {
    ctx.fillStyle = bg;
    roundRectPath(ctx, x, y, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = COLOR.white;
    ctx.font = `900 ${fontSize}px ${FONT_BODY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.textAlign = 'left';
  }
}

function drawImageBox(ctx, img, x, y, w, h, dry) {
  if (dry) return;
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  grad.addColorStop(0, COLOR.imgTop);
  grad.addColorStop(1, COLOR.imgBottom);
  ctx.fillStyle = grad;
  roundRectPath(ctx, x, y, w, h, 28);
  ctx.fill();
  if (img) {
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 28);
    ctx.clip();
    // 사진이 잘리지 않도록 비율을 유지해서 상자 안에 들어오게(contain) 그려요.
    const ratio = Math.min(w / img.width, h / img.height);
    const dw = img.width * ratio;
    const dh = img.height * ratio;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }
  ctx.strokeStyle = COLOR.white;
  ctx.lineWidth = 6;
  roundRectPath(ctx, x, y, w, h, 28);
  ctx.stroke();
}

// 점선 테두리 말풍선 상자
function drawDashedBox(ctx, x, y, w, h, dry) {
  if (dry) return;
  ctx.fillStyle = COLOR.white;
  roundRectPath(ctx, x, y, w, h, 24);
  ctx.fill();
  ctx.save();
  ctx.setLineDash([14, 10]);
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 4;
  roundRectPath(ctx, x, y, w, h, 24);
  ctx.stroke();
  ctx.restore();
}

// ---------- 카드 한 장 그리기 ----------
const HEADER_H = 120; // 물결 머리띠 높이
const FRAME = 14; // 바깥 테두리 두께

// dry=true 이면 실제로 그리지 않고 "끝나는 y 위치"만 계산해요. (내용이 많으면 글씨를 줄이려고)
function drawCardBody(ctx, item, img, scale, dry, imgH) {
  const PAD = 44;
  const innerW = CARD_W - PAD * 2;
  const kind = item.kind || 'word';
  let y = HEADER_H + 40;

  // 이미지가 없어도 이미지 칸은 항상 남겨둬요. (칸의 높이는 renderCard가 카드에 꼭 맞게 정해줘요.)
  drawImageBox(ctx, img, PAD, y, innerW, imgH, dry);
  y += imgH + Math.round(28 * scale);

  // 글 상자: 줄바꿈한 글을 점선 상자 안에 그려요. (라벨 칩 + 글)
  const drawTextBox = (label, chipBg, chipW, text, fontSize, color, maxLines, weight) => {
    const padIn = 18;
    const chipH = Math.round(36 * scale);
    ctx.font = `${weight} ${fontSize}px ${FONT_BODY}`;
    const lines = wrapLines(ctx, text, innerW - padIn * 2, maxLines);
    const lineH = Math.round(fontSize * 1.42);
    const boxH = padIn + chipH + Math.round(10 * scale) + lines.length * lineH + padIn - 4;
    drawDashedBox(ctx, PAD, y, innerW, boxH, dry);
    drawChip(ctx, PAD + padIn, y + padIn, chipW, chipH, label, chipBg, Math.round(21 * scale), dry);
    let ty = y + padIn + chipH + Math.round(10 * scale);
    lines.forEach((ln) => {
      if (!dry) {
        ctx.font = `${weight} ${fontSize}px ${FONT_BODY}`;
        ctx.fillStyle = color;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillText(ln, PAD + padIn, ty);
      }
      ty += lineH;
    });
    y += boxH + Math.round(16 * scale);
  };

  if (kind === 'expression') {
    const isChuja = item.language === 'chuja';
    const chipBg = isChuja ? COLOR.chujaChip : COLOR.jejuChip;
    const textColor = isChuja ? COLOR.chuja : COLOR.jeju;
    drawTextBox(isChuja ? '추자생활언어' : '제주어', chipBg, isChuja ? 180 : 110, item.text, Math.round(52 * scale), textColor, 5, 900);
    if (item.meaning) {
      drawTextBox('뜻', COLOR.standardChip, 70, item.meaning, Math.round(34 * scale), COLOR.ink, 6, 700);
    }
    return y;
  }

  // ----- 낱말 카드 -----
  const rows = [
    ['표준어', item.standard, COLOR.standardChip, COLOR.standard],
    ['제주어', item.jeju, COLOR.jejuChip, COLOR.jeju],
    ['추자생활언어', item.chuja, COLOR.chujaChip, COLOR.chuja],
  ];
  const chipW = 178;
  const textX = PAD + chipW + 22;
  const rowH = Math.round(92 * scale);
  rows.forEach(([label, value, chipBg, textColor]) => {
    const chipH = Math.round(40 * scale);
    drawChip(ctx, PAD, y + Math.round((rowH - chipH) / 2) - 4, chipW, chipH, label, chipBg, Math.round(23 * scale), dry);
    const text = String(value || '');
    const size = fitFontSize(ctx, text, FONT_TITLE, 900, Math.round(60 * scale), 26, CARD_W - PAD - textX);
    if (!dry) {
      ctx.font = `900 ${size}px ${FONT_TITLE}`;
      ctx.fillStyle = textColor;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText(text, textX, y + rowH / 2 - 4);
    }
    y += rowH;
  });

  const ex = item.examples || {};
  const exRows = [
    ['제주어 예문', ex.jeju, COLOR.jejuChip],
    ['추자생활언어 예문', ex.chuja, COLOR.chujaChip],
  ].filter(([, text]) => text && String(text).trim());
  if (exRows.length > 0) y += Math.round(10 * scale);
  exRows.forEach(([label, text, chipBg]) => {
    ctx.font = `700 ${Math.round(21 * scale)}px ${FONT_BODY}`;
    const labelW = Math.round(ctx.measureText(label).width + 40);
    drawTextBox(label, chipBg, labelW, text, Math.round(32 * scale), COLOR.ink, 4, 700);
  });
  return y;
}

function renderCard(canvas, item, img) {
  const ctx = canvas.getContext('2d');
  canvas.width = CARD_W;
  canvas.height = CARD_H;

  // 카드 높이에 꼭 맞게: 글(낱말·예문)이 차지하는 높이를 빼고 남는 만큼을 이미지 칸으로 써요.
  // 글이 많으면 글씨를 줄이고, 적으면 글씨를 조금 키워서 위·아래 여백이 거의 없게 맞춰요.
  const limit = CARD_H - FRAME - 30;
  const MIN_IMG = 230;
  const scales = [1.12, 1.06, 1, 0.93, 0.86, 0.79, 0.72, 0.65, 0.58, 0.52];
  let chosen = scales[scales.length - 1];
  let imgH = 120;
  for (const s of scales) {
    const room = limit - drawCardBody(ctx, item, null, s, true, 0);
    if (room >= MIN_IMG) {
      chosen = s;
      imgH = Math.floor(room);
      break;
    }
    if (s === scales[scales.length - 1]) imgH = Math.max(100, Math.floor(room));
  }

  // 바탕
  ctx.fillStyle = COLOR.paper;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  drawCardBody(ctx, item, img, chosen, false, imgH);

  // 물결 머리띠 (아래쪽이 물결 모양)
  ctx.fillStyle = COLOR.accent;
  ctx.fillRect(0, 0, CARD_W, HEADER_H - 14);
  const r = 22;
  for (let cx = r; cx < CARD_W + r; cx += r * 2) {
    ctx.beginPath();
    ctx.arc(cx, HEADER_H - 14, r, 0, Math.PI);
    ctx.fill();
  }
  ctx.fillStyle = COLOR.white;
  ctx.font = `400 36px ${FONT_BRAND}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('추자초 5학년 말바당 사전', CARD_W / 2, 56);
  ctx.textAlign = 'left';

  // 바깥 테두리 (카드 자르는 선 역할도 해요)
  ctx.strokeStyle = COLOR.accent;
  ctx.lineWidth = FRAME * 2;
  ctx.strokeRect(0, 0, CARD_W, CARD_H);
}

// ---------- 글꼴/이미지 준비 ----------
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

async function ensureFonts(items) {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
  // 카드에 실제로 쓰이는 글자들을 같이 알려줘야 필요한 글꼴 조각이 내려받아져요.
  const sample = items
    .map((it) => [it.standard, it.jeju, it.chuja, it.text, it.meaning, it.examples && it.examples.jeju, it.examples && it.examples.chuja].join(' '))
    .join(' ')
    .concat(' 추자초 5학년 말바당 사전 표준어 제주어 추자생활언어 예문 뜻');
  try {
    await withTimeout(
      Promise.all([
        document.fonts.load('34px "Jua"', sample),
        document.fonts.load('400 28px "Noto Sans KR"', sample),
        document.fonts.load('500 28px "Noto Sans KR"', sample),
        document.fonts.load('700 22px "Noto Sans KR"', sample),
        document.fonts.load('900 22px "Noto Sans KR"', sample),
      ]),
      5000
    );
  } catch (e) {
    // 글꼴을 못 받아도 기본 한글 글꼴로 계속 진행해요.
  }
}

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function canvasToJpegBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('카드 그림을 만들지 못했어요.'));
          return;
        }
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      },
      'image/jpeg',
      0.92
    );
  });
}

// ---------- PDF 파일 조립 ----------
const mmToPt = (mm) => (mm * 72) / 25.4;
const num = (n) => Number(n.toFixed(3)).toString();

// images: [{ bytes(JPEG), w, h }]
// pages:  [{ widthMm, heightMm, placements: [{ imgIndex, xMm, yTopMm }] }]  (카드 크기는 항상 64×89mm)
export function buildPdfBlob(images, pages) {
  const enc = new TextEncoder();
  const chunks = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };

  const imgIds = images.map((_, i) => 3 + i);
  let nextId = 3 + images.length;
  const pageDefs = pages.map((p) => {
    const def = { ...p, contentId: nextId, pageId: nextId + 1 };
    nextId += 2;
    return def;
  });
  const lastId = nextId - 1;
  const offsets = [];
  const beginObj = (id) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  push('%PDF-1.4\n%âãÏÓ\n');
  beginObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  beginObj(2);
  push(`<< /Type /Pages /Kids [${pageDefs.map((p) => `${p.pageId} 0 R`).join(' ')}] /Count ${pageDefs.length} >>\nendobj\n`);

  images.forEach((img, i) => {
    beginObj(imgIds[i]);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`
    );
    push(img.bytes);
    push('\nendstream\nendobj\n');
  });

  pageDefs.forEach((p) => {
    const pageHPt = mmToPt(p.heightMm);
    const cw = mmToPt(CARD_W_MM);
    const ch = mmToPt(CARD_H_MM);
    const ops = p.placements
      .map((pl) => {
        const x = mmToPt(pl.xMm);
        const y = pageHPt - mmToPt(pl.yTopMm) - ch; // PDF는 왼쪽 아래가 (0,0)
        return `q ${num(cw)} 0 0 ${num(ch)} ${num(x)} ${num(y)} cm /Im${pl.imgIndex} Do Q`;
      })
      .join('\n');
    beginObj(p.contentId);
    push(`<< /Length ${enc.encode(ops).length} >>\nstream\n${ops}\nendstream\nendobj\n`);
    const used = [...new Set(p.placements.map((pl) => pl.imgIndex))];
    const xobjects = used.map((i) => `/Im${i} ${imgIds[i]} 0 R`).join(' ');
    beginObj(p.pageId);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(mmToPt(p.widthMm))} ${num(pageHPt)}] /Resources << /XObject << ${xobjects} >> >> /Contents ${p.contentId} 0 R >>\nendobj\n`
    );
  });

  const xrefStart = length;
  push(`xref\n0 ${lastId + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= lastId; id++) {
    push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${lastId + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

// ---------- 바깥에서 쓰는 함수 ----------
// items: 낱말/표현 객체 배열 (이미지가 필요하면 imageUrl이 들어 있어야 해요)
export async function makeCardsPdf(items, onProgress) {
  if (!items || items.length === 0) throw new Error('만들 카드가 없어요.');
  await ensureFonts(items);

  const canvas = document.createElement('canvas');
  const images = [];
  for (let i = 0; i < items.length; i++) {
    const img = await loadImage(items[i].imageUrl);
    renderCard(canvas, items[i], img);
    const bytes = await canvasToJpegBytes(canvas);
    images.push({ bytes, w: CARD_W, h: CARD_H });
    if (onProgress) onProgress(i + 1, items.length);
    // 화면이 멈추지 않도록 잠깐 숨 돌릴 틈을 줘요.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  let pages;
  if (items.length === 1) {
    pages = [{ widthMm: CARD_W_MM, heightMm: CARD_H_MM, placements: [{ imgIndex: 0, xMm: 0, yTopMm: 0 }] }];
  } else {
    const { cols, perPage, x0, y0 } = a4Layout();
    pages = [];
    for (let start = 0; start < items.length; start += perPage) {
      const placements = [];
      for (let k = 0; k < perPage && start + k < items.length; k++) {
        const col = k % cols;
        const row = Math.floor(k / cols);
        placements.push({
          imgIndex: start + k,
          xMm: x0 + col * CARD_W_MM,
          yTopMm: y0 + row * CARD_H_MM,
        });
      }
      pages.push({ widthMm: A4_W_MM, heightMm: A4_H_MM, placements });
    }
  }
  return buildPdfBlob(images, pages);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
