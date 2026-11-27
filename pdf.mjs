// 캔버스 내용을 인쇄용 PDF로 만듭니다.
// 글자는 PDF 글자(벡터)로, 사진은 인쇄 크기 기준 300dpi로 넣습니다.
// 캔버스 1단위 = PDF 1pt 이므로 크기 변환은 없습니다.
import { fontBytes, nearestWeight } from './fonts.mjs';
import { subsetFont, unwoff } from './subset.mjs';

const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = window.PDFLib;
const PRINT_DPI = 300;

function toRgb(color) {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = '#000';
  c.fillStyle = color || '#000';
  const hex = c.fillStyle; // 항상 #rrggbb 또는 rgba(...)
  if (hex.startsWith('#')) {
    const n = parseInt(hex.slice(1), 16);
    return { color: rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255), alpha: 1 };
  }
  const [r, g, b, a = 1] = hex.match(/[\d.]+/g).map(Number);
  return { color: rgb(r / 255, g / 255, b / 255), alpha: a };
}

// opts.cuts: 재단선 위치 { xs: 세로선 x들, ys: 가로선 y들 } (캔버스 좌표)
export async function buildPdf(canvas, size, opts = {}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(window.fontkit);
  doc.setCreator('WAVEROCK 디자인 에디터');
  const page = doc.addPage([size.w, size.h]);

  const bg = canvas.backgroundColor;
  if (bg) {
    const { color, alpha } = toRgb(bg);
    page.drawRectangle({ x: 0, y: 0, width: size.w, height: size.h, color, opacity: alpha });
  }

  // 글꼴마다 실제로 쓴 글자를 모아, 그 글자만 담은 작은 글꼴을 PDF에 넣습니다.
  const fontKey = t => `${t.fontFamily}/${nearestWeight(t.fontFamily, t.fontWeight)}`;
  const used = new Map();
  for (const t of canvas.getObjects()) {
    if (t.visible && t.isType('Textbox', 'IText', 'Text')) {
      const k = fontKey(t);
      if (!used.has(k)) used.set(k, { family: t.fontFamily, weight: t.fontWeight, text: '' });
      used.get(k).text += t.text;
    }
  }
  const fonts = new Map();
  await Promise.all([...used].map(async ([k, { family, weight, text }]) => {
    const bytes = await fontBytes(family, weight);
    try {
      const small = await subsetFont(bytes, text);
      // 먼저 빈 문서에 넣어 보고, pdf-lib이 읽을 수 있을 때만 실제 문서에 넣습니다.
      const probe = await PDFDocument.create();
      probe.registerFontkit(window.fontkit);
      (await probe.embedFont(small)).encodeText(text.replace(/\s/g, '') || 'A');
      fonts.set(k, { font: await doc.embedFont(small) });
    } catch (err) {
      // pdf-lib이 못 읽는 글꼴(CFF 형식 OTF 등)은 글자 모양을 벡터 도형으로 그려 넣습니다. 인쇄 품질은 같습니다.
      console.warn('글꼴을 도형으로 넣습니다', family, err);
      fonts.set(k, { outline: await outlineFont(bytes) });
    }
  }));
  const getFont = t => fonts.get(fontKey(t));

  for (const obj of canvas.getObjects()) {
    if (!obj.visible || obj.excludeFromExport) continue;
    // 캔버스 좌표(위가 0)를 PDF 좌표(아래가 0)로 뒤집고, 요소의 위치·회전·크기를 그대로 적용합니다.
    page.pushOperators(
      pushGraphicsState(),
      concatTransformationMatrix(1, 0, 0, -1, 0, size.h),
      concatTransformationMatrix(...obj.calcTransformMatrix()),
    );
    if (obj.isType('Textbox', 'IText', 'Text')) drawText(page, obj, getFont(obj));
    else if (obj.isType('Image')) await drawImage(doc, page, obj);
    else if (obj.isType('Rect')) drawRect(page, obj);
    else if (obj.isType('Path')) drawPath(page, obj);
    page.pushOperators(popGraphicsState());
  }

  // 재단선: 가는 회색 점선. 캔버스 좌표(위가 0)를 PDF 좌표(아래가 0)로 바꿔 긋습니다.
  const cut = { thickness: 0.5, color: rgb(0.55, 0.55, 0.55), dashArray: [4, 3] };
  (opts.cuts?.xs || []).forEach(x => page.drawLine({ ...cut, start: { x, y: 0 }, end: { x, y: size.h } }));
  (opts.cuts?.ys || []).forEach(y => page.drawLine({ ...cut, start: { x: 0, y: size.h - y }, end: { x: size.w, y: size.h - y } }));

  return doc.save();
}

// 화면(Fabric)이 계산한 줄바꿈과 글자 위치를 그대로 옮깁니다. 그래서 화면과 PDF의 줄이 똑같이 나뉩니다.
function drawText(page, t, { font, outline }) {
  // 글자마다 색이 다를 수 있어(부분 색), 같은 색은 한 번만 변환합니다.
  const colors = new Map();
  const paint = fill => {
    if (!colors.has(fill)) {
      const { color, alpha } = toRgb(fill);
      colors.set(fill, { color, opacity: alpha * (t.opacity ?? 1) });
    }
    return colors.get(fill);
  };
  let lineTop = -t.height / 2;
  for (let i = 0; i < t._textLines.length; i++) {
    const h = t.getHeightOfLineImpl(i);
    const baseline = lineTop + h * (1 - t._fontSizeFraction);
    const lineLeft = -t.width / 2 + t._getLineLeftOffset(i);
    const bounds = t.__charBounds[i];
    t._textLines[i].forEach((ch, k) => {
      if (!ch.trim()) return;
      const b = bounds[k];
      const x = lineLeft + b.left + (b.kernedWidth - b.width);
      const { color, opacity } = paint(t.getValueOfPropertyAt(i, k, 'fill'));
      if (font) {
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, x, baseline));
        page.drawText(ch, { x: 0, y: 0, size: t.fontSize, font, color, opacity });
      } else {
        const path = outline.path(ch);
        if (!path) return;
        const s = t.fontSize / outline.upem;
        page.pushOperators(pushGraphicsState(), concatTransformationMatrix(s, 0, 0, s, x, baseline));
        page.drawSvgPath(path, { x: 0, y: 0, color, opacity, borderWidth: 0 });
      }
      page.pushOperators(popGraphicsState());
    });
    lineTop += t.getHeightOfLine(i);
  }
}

function drawRect(page, r) {
  const fill = r.fill && r.fill !== 'transparent' ? toRgb(r.fill) : null;
  const stroke = r.stroke && r.strokeWidth ? toRgb(r.stroke) : null;
  page.drawRectangle({
    x: -r.width / 2, y: -r.height / 2, width: r.width, height: r.height,
    color: fill?.color, opacity: (fill?.alpha ?? 1) * (r.opacity ?? 1),
    borderColor: stroke?.color, borderWidth: stroke ? r.strokeWidth : 0,
  });
}

// 사진은 인쇄 크기에서 300dpi가 되도록 줄여 넣습니다. 원본이 더 작으면 원본 그대로 씁니다.
async function drawImage(doc, page, img) {
  const el = img.getElement();
  const sw = img.width, sh = img.height; // 원본에서 잘라 쓰는 부분(px)
  const printW = img.getScaledWidth() / 72; // 인치
  const scale = Math.min(1, (printW * PRINT_DPI) / sw);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(el, img.cropX || 0, img.cropY || 0, sw, sh, 0, 0, c.width, c.height);
  const png = img.isPng;
  const blob = await new Promise(res => c.toBlob(res, png ? 'image/png' : 'image/jpeg', 0.92));
  const bytes = await blob.arrayBuffer();
  const embedded = png ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  // 지금 좌표는 아래로 갈수록 +y 이므로 한 번 더 뒤집어 사진이 바로 서게 합니다.
  page.pushOperators(concatTransformationMatrix(1, 0, 0, -1, 0, 0));
  page.drawImage(embedded, { x: -sw / 2, y: -sh / 2, width: sw, height: sh, opacity: img.opacity ?? 1 });
}

// 글자 모양(벡터 윤곽)을 꺼내는 도구. 필요할 때만 불러옵니다.
async function outlineFont(buffer) {
  const hb = await import('./vendor/harfbuzzjs/index.mjs');
  const face = new hb.Face(new hb.Blob(await unwoff(new Uint8Array(buffer))));
  const font = new hb.Font(face);
  return {
    upem: face.upem,
    path(ch) {
      const g = font.nominalGlyph(ch.codePointAt(0));
      return g === undefined ? '' : font.glyphToPath(g);
    },
  };
}

// 아이콘 등 도형 경로. Fabric 경로는 자기 가운데(pathOffset)를 기준으로 그려집니다.
function drawPath(page, p) {
  const d = p.path.map(seg => seg.join(' ')).join(' ');
  const { color, alpha } = toRgb(p.fill);
  page.pushOperators(concatTransformationMatrix(1, 0, 0, -1, 0, 0));
  page.drawSvgPath(d, { x: -p.pathOffset.x, y: p.pathOffset.y, color, opacity: alpha * (p.opacity ?? 1), borderWidth: 0 });
}
