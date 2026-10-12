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
const FONT_TITLE = `"Jua", ${FONT_BODY}`;

const COLOR = {
  paper: '#FFF7E8',
  white: '#FFFFFF',
  ink: '#33304D',
  inkSoft: '#7A7396',
  line: '#FFE3B0',
  accent: '#5FA044',
  accentDark: '#457A30',
  standard: '#4B3F72',
  jeju: '#E36A1A',
  jejuChip: '#FF8A3D',
  chuja: '#128F85',
  chujaChip: '#22C3B6',
  cut: '#B8B0A0',
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
    ctx.font = `700 ${fontSize}px ${FONT_BODY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    ctx.textAlign = 'left';
  }
}

function drawImageBox(ctx, img, x, y, w, h, dry) {
  if (dry) return;
  ctx.fillStyle = COLOR.white;
  roundRectPath(ctx, x, y, w, h, 22);
  ctx.fill();
  ctx.save();
  roundRectPath(ctx, x, y, w, h, 22);
  ctx.clip();
  // 사진이 잘리지 않도록 비율을 유지해서 상자 안에 들어오게(contain) 그려요.
  const ratio = Math.min(w / img.width, h / img.height);
  const dw = img.width * ratio;
  const dh = img.height * ratio;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
  ctx.strokeStyle = COLOR.line;
  ctx.lineWidth = 3;
  roundRectPath(ctx, x, y, w, h, 22);
  ctx.stroke();
}

// ---------- 카드 한 장 그리기 ----------
// dry=true 이면 실제로 그리지 않고 "끝나는 y 위치"만 계산해요. (내용이 많으면 글씨를 줄이려고)
function drawCardBody(ctx, item, img, scale, dry) {
  const PAD = 40;
  const innerW = CARD_W - PAD * 2;
  const kind = item.kind || 'word';
  let y = 88 + 30;

  if (img) {
    const boxH = Math.round(290 * scale);
    drawImageBox(ctx, img, PAD, y, innerW, boxH, dry);
    y += boxH + Math.round(26 * scale);
  }

  const drawDivider = () => {
    if (!dry) {
      ctx.strokeStyle = COLOR.line;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(PAD, y);
      ctx.lineTo(CARD_W - PAD, y);
      ctx.stroke();
    }
    y += Math.round(22 * scale);
  };

  if (kind === 'expression') {
    const isChuja = item.language === 'chuja';
    const chipBg = isChuja ? COLOR.chujaChip : COLOR.jejuChip;
    const textColor = isChuja ? COLOR.chuja : COLOR.jeju;
    const chipH = Math.round(42 * scale);
    drawChip(ctx, PAD, y, isChuja ? 190 : 110, chipH, isChuja ? '추자생활언어' : '제주어', chipBg, Math.round(24 * scale), dry);
    y += chipH + Math.round(18 * scale);

    const size = Math.round(54 * scale);
    ctx.font = `400 ${size}px ${FONT_TITLE}`;
    const lines = wrapLines(ctx, item.text, innerW, 5);
    const lineH = Math.round(size * 1.3);
    lines.forEach((ln) => {
      if (!dry) {
        ctx.fillStyle = textColor;
        ctx.textBaseline = 'top';
        ctx.fillText(ln, PAD, y);
      }
      y += lineH;
    });
    y += Math.round(10 * scale);

    if (item.meaning) {
      drawDivider();
      const mChipH = Math.round(36 * scale);
      drawChip(ctx, PAD, y, 70, mChipH, '뜻', COLOR.standard, Math.round(24 * scale), dry);
      y += mChipH + Math.round(12 * scale);
      const mSize = Math.round(36 * scale);
      ctx.font = `500 ${mSize}px ${FONT_BODY}`;
      const mLines = wrapLines(ctx, item.meaning, innerW, 6);
      mLines.forEach((ln) => {
        if (!dry) {
          ctx.fillStyle = COLOR.ink;
          ctx.textBaseline = 'top';
          ctx.fillText(ln, PAD, y);
        }
        y += Math.round(mSize * 1.45);
      });
    }
    return y;
  }

  // ----- 낱말 카드 -----
  const rows = [
    ['표준어', item.standard, COLOR.standard, COLOR.standard],
    ['제주어', item.jeju, COLOR.jejuChip, COLOR.jeju],
    ['추자생활언어', item.chuja, COLOR.chujaChip, COLOR.chuja],
  ];
  const chipW = 178;
  const textX = PAD + chipW + 22;
  const rowH = Math.round(88 * scale);
  rows.forEach(([label, value, chipBg, textColor]) => {
    const chipH = Math.round(40 * scale);
    drawChip(ctx, PAD, y + Math.round((rowH - chipH) / 2) - 4, chipW, chipH, label, chipBg, Math.round(23 * scale), dry);
    const text = String(value || '');
    const size = fitFontSize(ctx, text, FONT_TITLE, 400, Math.round(58 * scale), 26, CARD_W - PAD - textX);
    if (!dry) {
      ctx.font = `400 ${size}px ${FONT_TITLE}`;
      ctx.fillStyle = textColor;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, textX, y + rowH / 2 - 4);
    }
    y += rowH;
  });

  const ex = item.examples || {};
  const exRows = [
    ['제주어 예문', ex.jeju, COLOR.jejuChip],
    ['추자생활언어 예문', ex.chuja, COLOR.chujaChip],
  ].filter(([, text]) => text && String(text).trim());

  if (exRows.length > 0) {
    y += Math.round(6 * scale);
    drawDivider();
    const exSize = Math.round(34 * scale);
    exRows.forEach(([label, text, chipBg]) => {
      const chipH = Math.round(34 * scale);
      ctx.font = `700 ${Math.round(23 * scale)}px ${FONT_BODY}`;
      const labelW = Math.round(ctx.measureText(label).width + 36);
      drawChip(ctx, PAD, y, labelW, chipH, label, chipBg, Math.round(21 * scale), dry);
      y += chipH + Math.round(8 * scale);
      ctx.font = `500 ${exSize}px ${FONT_BODY}`;
      const lines = wrapLines(ctx, text, innerW, 4);
      lines.forEach((ln) => {
        if (!dry) {
          ctx.fillStyle = COLOR.ink;
          ctx.textBaseline = 'top';
          ctx.fillText(ln, PAD, y);
        }
        y += Math.round(exSize * 1.42);
      });
      y += Math.round(16 * scale);
    });
  }
  return y;
}

function renderCard(canvas, item, img) {
  const ctx = canvas.getContext('2d');
  canvas.width = CARD_W;
  canvas.height = CARD_H;

  // 내용이 많으면 글씨를 조금씩 줄여서 카드 안에 다 들어가게 해요.
  const limit = CARD_H - 36;
  const scales = [1, 0.93, 0.86, 0.79, 0.72, 0.65, 0.58];
  let chosen = scales[scales.length - 1];
  for (const s of scales) {
    if (drawCardBody(ctx, item, img, s, true) <= limit) {
      chosen = s;
      break;
    }
  }

  // 바탕
  ctx.fillStyle = COLOR.paper;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  // 머리말 띠
  ctx.fillStyle = COLOR.accent;
  ctx.fillRect(0, 0, CARD_W, 88);
  ctx.fillStyle = COLOR.white;
  ctx.font = `400 34px ${FONT_TITLE}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('추자초 5학년 말바당 사전', CARD_W / 2, 46);
  ctx.textAlign = 'left';

  drawCardBody(ctx, item, img, chosen, false);

  // 아래쪽 장식 선
  ctx.fillStyle = COLOR.accent;
  ctx.fillRect(0, CARD_H - 14, CARD_W, 14);
  // 자르는 선(카드 가장자리)
  ctx.strokeStyle = COLOR.cut;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, CARD_W - 3, CARD_H - 3);
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
