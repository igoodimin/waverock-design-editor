import { Canvas, Textbox, FabricImage, InteractiveFabricObject, Control, cache } from './vendor/fabric.min.mjs';
import { FONTS, nearestWeight, loadWebFont } from './fonts.mjs';
import { buildPdf } from './pdf.mjs';

// 캔버스 1단위 = PDF 1pt. A4 = 210 × 297mm.
const SIZES = { portrait: { w: 595.28, h: 841.89 }, landscape: { w: 841.89, h: 595.28 } };
// 처음 화면 배치가 바뀔 때마다 숫자를 올립니다. 이전 자동 저장은 무시하고 새 배치로 시작합니다.
const STORE = 'wde-doc-v2';
const EXTRA_PROPS = ['isPng'];

// 글 스타일 4가지. 스태프는 여기서 골라 시작합니다. width는 대지 폭에 대한 비율입니다.
const PRESETS = {
  title:   { text: '제목을 입력하세요', fontFamily: 'Pretendard', fontWeight: 900, fontSize: 72, lineHeight: 1.2, width: 0.92 },
  enTitle: { text: 'ENGLISH TITLE', fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 36, lineHeight: 1.1, width: 0.7, soft: true },
  body:    { text: '본문 내용을 입력하세요.\n두 줄까지 쓰면 읽기 좋아요.', fontFamily: 'Pretendard', fontWeight: 700, fontSize: 24, lineHeight: 1.5, width: 0.8 },
  enBody:  { text: 'English description goes here.', fontFamily: 'Pretendard', fontWeight: 400, fontSize: 14, lineHeight: 1.4, width: 0.8 },
};
// 영문 타이틀은 본문보다 조금 연한 색으로 시작합니다.
const inkFor = (soft, bg) => (isDark(bg) ? (soft ? '#b3b3b3' : '#ffffff') : (soft ? '#808080' : '#000000'));
const COLORS = ['#000000', '#ffffff', '#6b6b6b', '#d9d9d9', '#e1251b', '#ff7a00', '#ffd400', '#1f6feb', '#1a7f37'];

const $ = id => document.getElementById(id);
const state = { orientation: 'landscape' };
const size = () => SIZES[state.orientation];

// 선택 테두리와 손잡이를 툴 UI 색에 맞춥니다.
Object.assign(InteractiveFabricObject.ownDefaults, {
  borderColor: '#222', cornerColor: '#fff', cornerStrokeColor: '#222',
  cornerStyle: 'circle', cornerSize: 10, transparentCorners: false, borderScaleFactor: 1.5, padding: 2,
});

const canvas = new Canvas($('canvas'), {
  backgroundColor: '#ffffff',
  preserveObjectStacking: true,
  selectionColor: 'rgba(34,34,34,.06)',
  selectionBorderColor: '#222',
});

// ── 화면 크기에 맞춰 대지 확대/축소 ──
function fit() {
  const { w, h } = size();
  const avail = $('main').clientWidth;
  const zoom = Math.max(0.4, Math.min(avail / w, (window.innerHeight - 150) / h, 1.6));
  canvas.setDimensions({ width: Math.round(w * zoom), height: Math.round(h * zoom) });
  canvas.setZoom(zoom);
}
new ResizeObserver(fit).observe($('main'));

function status(msg, isError = false) {
  $('status').textContent = msg;
  $('status').classList.toggle('error', isError);
}

// ── 글꼴: 웹폰트가 준비된 뒤 글자 폭을 다시 계산합니다 ──
async function ensureFonts(objs) {
  const texts = objs.filter(o => o.isType('Textbox'));
  await Promise.all(texts.map(t => loadWebFont(t.fontFamily, t.fontWeight, t.text)));
  new Set(texts.map(t => t.fontFamily)).forEach(f => cache.clearFontCache(f));
  texts.forEach(t => { t.initDimensions(); t.setCoords(); });
  canvas.requestRenderAll();
}

// ── 자동 저장 ──
let saveTimer;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ v: 1, orientation: state.orientation, pristine: !!state.pristine, canvas: canvas.toObject(EXTRA_PROPS) }));
    } catch {
      status('사진이 많아 브라우저 자동 저장 공간이 가득 찼어요. PDF로 먼저 저장해 두세요.', true);
    }
  }, 400);
}
canvas.on('object:modified', scheduleSave);
// 처음 예시를 아직 손대지 않았는지 기억합니다. 손대기 전이면 용지 방향을 바꿀 때 그 방향의 예시로 바꿔 보여 줍니다.
['object:modified', 'text:changed'].forEach(ev => canvas.on(ev, () => { state.pristine = false; }));
canvas.on('object:added', scheduleSave);

// 선택 상자 오른쪽 위의 ✕ 단추로 바로 지울 수 있게 합니다.
const deleteControl = new Control({
  x: 0.5, y: -0.5, offsetX: 14, offsetY: -14, sizeX: 22, sizeY: 22,
  cursorStyle: 'pointer',
  mouseUpHandler: () => { removeActive(); return true; },
  render(ctx, left, top) {
    ctx.save();
    ctx.translate(left, top);
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#b42318';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4, -4); ctx.lineTo(4, 4);
    ctx.moveTo(4, -4); ctx.lineTo(-4, 4);
    ctx.stroke();
    ctx.restore();
  },
});
canvas.on('object:added', ({ target }) => { target.controls = { ...target.controls, del: deleteControl }; });

// 글을 모두 지우고 편집을 마치면 빈 글상자도 함께 지웁니다.
canvas.on('text:editing:exited', ({ target }) => {
  if (!target || target.text.trim()) return;
  // 편집 종료 처리가 끝난 다음에 지워야 오류가 나지 않습니다.
  setTimeout(() => {
    if (canvas.getActiveObject() === target) canvas.discardActiveObject();
    canvas.remove(target);
    canvas.requestRenderAll();
  });
});
canvas.on('object:removed', scheduleSave);
canvas.on('text:changed', scheduleSave);

// ── 요소 추가 ──
function makeText(key, top) {
  const { text, width, soft, ...p } = PRESETS[key];
  const { w, h } = size();
  return new Textbox(text, {
    ...p, width: w * width, fill: inkFor(soft, canvas.backgroundColor), textAlign: 'center',
    originX: 'center', originY: 'center', left: w / 2, top: top ?? h / 2,
  });
}

// 새 요소는 항상 대지 가운데에 놓습니다.
async function addText(key) {
  state.pristine = false;
  const t = makeText(key);
  await ensureFonts([t]);
  canvas.add(t);
  canvas.setActiveObject(t);
  canvas.requestRenderAll();
}

// 사진은 A4 폭 300dpi(약 2480px)보다 크면 줄여서 보관합니다. 인쇄 품질은 그대로이고 저장 공간을 아낍니다.
async function addImage(file) {
  state.pristine = false;
  const isPng = file.type === 'image/png';
  const bitmap = await createImageBitmap(file);
  const max = 2480;
  const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * k);
  c.height = Math.round(bitmap.height * k);
  c.getContext('2d').drawImage(bitmap, 0, 0, c.width, c.height);
  const url = c.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.92);
  const img = await FabricImage.fromURL(url);
  const { w, h } = size();
  const scale = Math.min((w * 0.6) / img.width, (h * 0.4) / img.height);
  img.set({ isPng, scaleX: scale, scaleY: scale, originX: 'center', originY: 'center', left: w / 2, top: h / 2 });
  canvas.add(img);
  canvas.setActiveObject(img);
  canvas.requestRenderAll();
}

document.querySelectorAll('#add-text button').forEach(b => b.addEventListener('click', () => addText(b.dataset.preset)));
$('add-image').addEventListener('click', () => $('image-file').click());
$('image-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try { await addImage(file); } catch { status('사진을 열지 못했어요. JPG나 PNG 파일인지 확인해 주세요.', true); }
});

// ── 색 팔레트 ──
const RECENT = 'wde-recent-colors';
const recent = () => JSON.parse(localStorage.getItem(RECENT) || '[]');
function remember(color) {
  if (COLORS.includes(color)) return;
  const list = [color, ...recent().filter(c => c !== color)].slice(0, 8);
  localStorage.setItem(RECENT, JSON.stringify(list));
  palettes.forEach(p => p.draw());
}
const palettes = [];
function palette(el, get, set) {
  const p = {
    draw() {
      const cur = (get() || '').toLowerCase();
      const sw = c => `<button type="button" class="sw" style="--c:${c}" data-c="${c}" aria-pressed="${c === cur}" aria-label="${c}" title="${c}"></button>`;
      const r = recent();
      el.innerHTML = COLORS.map(sw).join('') +
        `<label class="pick" title="직접 고르기"><input type="color" value="${/^#[0-9a-f]{6}$/.test(cur) ? cur : '#000000'}" aria-label="색 직접 고르기"></label>` +
        (r.length ? `<span class="recent-label">최근 쓴 색</span>${r.map(sw).join('')}` : '');
    },
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('.sw');
    if (!b) return;
    set(b.dataset.c);
    p.draw();
  });
  el.addEventListener('input', e => { if (e.target.type === 'color') set(e.target.value); });
  el.addEventListener('change', e => { if (e.target.type === 'color') { remember(e.target.value.toLowerCase()); p.draw(); } });
  palettes.push(p);
  p.draw();
  return p;
}

function isDark(color) {
  const m = /^#([0-9a-f]{6})$/i.exec(color || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) < 128;
}

const bgPalette = palette($('bg-color'), () => canvas.backgroundColor, c => {
  canvas.backgroundColor = c;
  state.pristine = false;
  canvas.requestRenderAll();
  scheduleSave();
});

// ── 선택한 요소 설정 ──
const active = () => canvas.getActiveObject();
const activeText = () => (active()?.isType('Textbox') ? active() : null);

$('p-font').innerHTML = Object.entries(FONTS).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('');
function drawWeights(family, weight) {
  $('p-weight').innerHTML = Object.entries(FONTS[family]?.weights || {}).map(([w, label]) =>
    `<option value="${w}"${Number(w) === Number(weight) ? ' selected' : ''}>${label}</option>`).join('');
}

const textPalette = palette($('p-color'), () => activeText()?.fill, c => { updateText({ fill: c }); });

function showProps() {
  const o = active();
  $('props').hidden = !o || o.isType('ActiveSelection');
  if (!o) return;
  const t = activeText();
  $('text-props').hidden = !t;
  if (t) {
    $('p-font').value = t.fontFamily;
    drawWeights(t.fontFamily, t.fontWeight);
    $('p-size').value = Math.round(t.fontSize * 10) / 10;
    $('p-line').value = t.lineHeight;
    document.querySelectorAll('#p-align button').forEach(b => b.setAttribute('aria-pressed', b.dataset.a === t.textAlign));
    textPalette.draw();
  }
}
canvas.on('selection:created', showProps);
canvas.on('selection:updated', showProps);
canvas.on('selection:cleared', showProps);

async function updateText(props) {
  state.pristine = false;
  const t = activeText();
  if (!t) return;
  t.set(props);
  if (props.fontFamily || props.fontWeight) await ensureFonts([t]);
  t.setCoords();
  canvas.requestRenderAll();
  scheduleSave();
}

$('p-font').addEventListener('change', e => {
  const family = e.target.value;
  const fontWeight = nearestWeight(family, activeText()?.fontWeight);
  drawWeights(family, fontWeight);
  updateText({ fontFamily: family, fontWeight });
});
$('p-weight').addEventListener('change', e => updateText({ fontWeight: Number(e.target.value) }));
$('p-size').addEventListener('change', e => {
  const v = Math.min(400, Math.max(4, Number(e.target.value) || 12));
  e.target.value = v;
  updateText({ fontSize: v });
});
$('p-line').addEventListener('change', e => {
  const v = Math.min(3, Math.max(0.8, Number(e.target.value) || 1.3));
  e.target.value = v;
  updateText({ lineHeight: v });
});
document.querySelectorAll('#p-align button').forEach(b => b.addEventListener('click', () => {
  updateText({ textAlign: b.dataset.a });
  document.querySelectorAll('#p-align button').forEach(x => x.setAttribute('aria-pressed', x === b));
}));

// 크기 조절 손잡이로 글상자를 늘리면 글자 크기는 그대로 두고 상자 폭만 바뀝니다(Fabric 기본 동작).
// 모서리로 늘린 경우엔 비율을 글자 크기에 반영해 PDF와 화면이 같은 값을 쓰게 합니다.
canvas.on('object:modified', ({ target }) => {
  if (!target?.isType('Textbox') || (target.scaleX === 1 && target.scaleY === 1)) return;
  const k = target.scaleY;
  target.set({ fontSize: Math.round(target.fontSize * k * 10) / 10, width: target.width * target.scaleX, scaleX: 1, scaleY: 1 });
  target.setCoords();
  canvas.requestRenderAll();
  showProps();
  scheduleSave();
});

$('a-front').addEventListener('click', () => { const o = active(); if (o) { canvas.bringObjectForward(o); canvas.requestRenderAll(); scheduleSave(); } });
$('a-back').addEventListener('click', () => { const o = active(); if (o) { canvas.sendObjectBackwards(o); canvas.requestRenderAll(); scheduleSave(); } });
$('a-dup').addEventListener('click', duplicate);

// ── 글 한 번 클릭으로 바로 고치기 ──
// 끌거나 크기를 바꾸지 않고 클릭만 했다면, 클릭한 자리에 글 커서를 놓습니다.
let dragged = false;
canvas.on('mouse:down', () => { dragged = false; });
['object:moving', 'object:scaling', 'object:rotating', 'object:resizing'].forEach(ev => canvas.on(ev, () => { dragged = true; }));
canvas.on('mouse:up', ({ target, e }) => {
  if (dragged || !target?.isType('Textbox') || target.isEditing || canvas.getActiveObject() !== target) return;
  if (target.__corner) return; // 손잡이(크기·회전·✕)를 누른 경우
  target.enterEditing(e);
  target.setCursorByClick(e);
  target.hasControls = true; // 고치는 중에도 ✕·크기 손잡이를 쓸 수 있게 둡니다.
  canvas.requestRenderAll();
});

// ── 대지 가운데 맞춤 ──
function centerActive(axis) {
  state.pristine = false;
  const o = active();
  if (!o) return;
  const { w, h } = size();
  const c = o.getCenterPoint();
  o.setPositionByOrigin({ x: axis === 'y' ? c.x : w / 2, y: axis === 'x' ? c.y : h / 2 }, 'center', 'center');
  o.setCoords();
  canvas.requestRenderAll();
  scheduleSave();
}
$('c-x').addEventListener('click', () => centerActive('x'));
$('c-y').addEventListener('click', () => centerActive('y'));

// 끌어서 옮길 때 대지 가운데 근처에 오면 자석처럼 붙고 안내선이 보입니다.
const guides = { x: false, y: false };
canvas.on('object:moving', ({ target }) => {
  const { w, h } = size();
  const snap = 8 / canvas.getZoom();
  const c = target.getCenterPoint();
  guides.x = Math.abs(c.x - w / 2) < snap;
  guides.y = Math.abs(c.y - h / 2) < snap;
  if (guides.x || guides.y) {
    target.setPositionByOrigin({ x: guides.x ? w / 2 : c.x, y: guides.y ? h / 2 : c.y }, 'center', 'center');
  }
});
const hideGuides = () => { if (guides.x || guides.y) { guides.x = guides.y = false; canvas.requestRenderAll(); } };
canvas.on('mouse:up', hideGuides);
canvas.on('after:render', ({ ctx }) => {
  if (!guides.x && !guides.y) return;
  const z = canvas.getZoom();
  const { w, h } = size();
  ctx.save();
  ctx.strokeStyle = '#ff3b8d';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  if (guides.x) { ctx.moveTo(w / 2 * z + 0.5, 0); ctx.lineTo(w / 2 * z + 0.5, h * z); }
  if (guides.y) { ctx.moveTo(0, h / 2 * z + 0.5); ctx.lineTo(w * z, h / 2 * z + 0.5); }
  ctx.stroke();
  ctx.restore();
});
$('a-del').addEventListener('click', removeActive);

async function duplicate() {
  const o = active();
  if (!o || o.isType('ActiveSelection')) return;
  const c = await o.clone(EXTRA_PROPS);
  c.set({ left: o.left + 12, top: o.top + 12 });
  canvas.add(c);
  canvas.setActiveObject(c);
  canvas.requestRenderAll();
}
function removeActive() {
  state.pristine = false;
  const objs = canvas.getActiveObjects();
  objs.forEach(o => { if (o.isEditing) o.exitEditing(); });
  if (!objs.length) return;
  canvas.discardActiveObject();
  objs.forEach(o => canvas.remove(o));
  canvas.requestRenderAll();
}

// 키보드: 지우기, 복제(⌘D), 화살표로 1pt씩(⇧ 누르면 10pt) 옮기기
document.addEventListener('keydown', e => {
  const o = active();
  if (!o || o.isEditing || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeActive(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
  const step = e.shiftKey ? 10 : 1;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!d) return;
  e.preventDefault();
  state.pristine = false;
  o.set({ left: o.left + d[0], top: o.top + d[1] });
  o.setCoords();
  canvas.requestRenderAll();
  scheduleSave();
});

// ── 용지 방향 ──
function setOrientation(o) {
  if (o === state.orientation) return;
  const before = size();
  state.orientation = o;
  if (state.pristine) {
    canvas.discardActiveObject();
    canvas.remove(...canvas.getObjects());
    fit();
    starter().then(scheduleSave);
    document.querySelectorAll('#orientation button').forEach(b => b.setAttribute('aria-pressed', b.dataset.o === o));
    return;
  }
  // 대지가 바뀌어도 내용이 가운데에 머물도록 함께 옮깁니다.
  const dx = (size().w - before.w) / 2, dy = (size().h - before.h) / 2;
  canvas.getObjects().forEach(obj => {
    obj.set({ left: obj.left + dx, top: obj.top + dy });
    // 세로로 바꿔서 글상자가 대지보다 넓어지면, 폭과 글자 크기를 같은 비율로 줄여 줄바꿈이 그대로 유지되게 합니다.
    if (obj.isType('Textbox') && obj.width > size().w * 0.95) {
      const k = (size().w * 0.85) / obj.width;
      obj.set({ width: obj.width * k, fontSize: Math.round(obj.fontSize * k * 10) / 10 });
    }
    obj.setCoords();
  });
  document.querySelectorAll('#orientation button').forEach(b => b.setAttribute('aria-pressed', b.dataset.o === o));
  fit();
  scheduleSave();
}
document.querySelectorAll('#orientation button').forEach(b => b.addEventListener('click', () => setOrientation(b.dataset.o)));

// ── PDF 저장 ──
function fileName() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const texts = canvas.getObjects().filter(o => o.isType('Textbox') && o.text.trim());
  const main = texts.sort((a, b) => b.fontSize - a.fontSize)[0];
  const title = (main?.text || '출력물').replace(/\s+/g, '').replace(/[\\/:*?"<>|]/g, '').slice(0, 20);
  return `${ymd}_${title}_A4.pdf`;
}

$('save-pdf').addEventListener('click', async () => {
  const btn = $('save-pdf');
  btn.disabled = true;
  btn.textContent = 'PDF 만드는 중…';
  status('');
  try {
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    await ensureFonts(canvas.getObjects());
    const bytes = await buildPdf(canvas, size());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    a.download = fileName();
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    status(`${a.download} 저장했어요.`);
  } catch (err) {
    console.error(err);
    status(`PDF를 만들지 못했어요. ${err.message || ''}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'PDF 저장';
  }
});

// ── 새로 시작 ──
$('reset').addEventListener('click', () => $('reset-dialog').showModal());
$('reset-dialog').addEventListener('close', async () => {
  if ($('reset-dialog').returnValue !== 'ok') return;
  localStorage.removeItem(STORE);
  canvas.clear();
  canvas.backgroundColor = '#ffffff';
  bgPalette.draw();
  await starter();
  scheduleSave();
});

// 처음 열면 보이는 예시. 지민 님이 정한 배치(261127 시안)를 대지 가운데 기준 거리로 옮겼습니다.
// dy: 대지 세로 가운데에서 요소 가운데까지 거리(pt). 나머지 값은 PRESETS를 덮어씁니다.
const STARTER = {
  landscape: [
    { key: 'title', dy: -74.69 },
    { key: 'enTitle', dy: 0 },
    { key: 'body', dy: 119.98 },
    { key: 'enBody', dy: 190.98 },
  ],
  portrait: [
    { key: 'title', dy: -98.11, fontSize: 67 },
    { key: 'enTitle', dy: -23.42, fontSize: 52 },
    { key: 'body', dy: 116.08, fontSize: 25 },
    { key: 'enBody', dy: 184.47, fontSize: 20, fill: '#6b6b6b' },
  ],
};
async function starter() {
  const objs = STARTER[state.orientation].map(({ key, dy, ...over }) => {
    const t = makeText(key, size().h / 2 + dy);
    t.set(over);
    return t;
  });
  await ensureFonts(objs);
  canvas.add(...objs);
  state.pristine = true;
}

// ── 시작 ──
(async function init() {
  fit();
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  if (saved?.canvas && !saved.pristine) {
    state.orientation = saved.orientation || 'landscape';
    document.querySelectorAll('#orientation button').forEach(b => b.setAttribute('aria-pressed', b.dataset.o === state.orientation));
    await canvas.loadFromJSON(saved.canvas);
    await ensureFonts(canvas.getObjects());
    fit();
    bgPalette.draw();
  } else {
    // 손대지 않은 예시만 있었다면 저장된 방향의 최신 예시로 다시 그립니다.
    if (saved?.orientation) {
      state.orientation = saved.orientation;
      document.querySelectorAll('#orientation button').forEach(b => b.setAttribute('aria-pressed', b.dataset.o === state.orientation));
      fit();
    }
    await starter();
  }
  canvas.requestRenderAll();
  window.__wde = { canvas, size }; // 확인용
})();
