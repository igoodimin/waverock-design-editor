import { Canvas, Textbox, FabricImage, Path, InteractiveFabricObject, Control, cache } from './vendor/fabric.min.mjs';
import { FONTS, nearestWeight, loadWebFont } from './fonts.mjs';
import { buildPdf } from './pdf.mjs';

// 캔버스 1단위 = PDF 1pt. A4 = 210 × 297mm.
const SIZES = { portrait: { w: 595.28, h: 841.89 }, landscape: { w: 841.89, h: 595.28 } };
// 처음 화면 배치가 바뀔 때마다 숫자를 올립니다. 이전 자동 저장은 무시하고 새 배치로 시작합니다.
const STORE = 'wde-doc-v2';
const EXTRA_PROPS = ['isPng', 'iconName', 'wdeLock'];

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
const state = { orientation: 'landscape', a5: false, a6: false, pristine: false };
const size = () => SIZES[state.orientation];

// 나누기 모드에 따라 대지를 나눈 칸들을 돌려줍니다. 나누지 않으면 대지 전체 한 칸입니다.
// A5: 가로 A4는 왼쪽·오른쪽(세로형 A5 두 장), 세로 A4는 위·아래(가로형 A5 두 장)로 나뉩니다.
// A6: 가로·세로를 모두 반으로 나눠 네 칸이 됩니다. 순서는 왼쪽 위, 오른쪽 위, 왼쪽 아래, 오른쪽 아래입니다.
function regions() {
  const { w, h } = size();
  if (state.a6) return [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => ({ x: i * w / 2, y: j * h / 2, w: w / 2, h: h / 2 }));
  if (!state.a5) return [{ x: 0, y: 0, w, h }];
  return state.orientation === 'landscape'
    ? [{ x: 0, y: 0, w: w / 2, h }, { x: w / 2, y: 0, w: w / 2, h }]
    : [{ x: 0, y: 0, w, h: h / 2 }, { x: 0, y: h / 2, w, h: h / 2 }];
}
const regionIndex = pt => Math.max(0, regions().findIndex(r => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h));
const regionAt = pt => regions()[regionIndex(pt)];
// 재단선 위치. xs는 세로선, ys는 가로선입니다.
function cutLines() {
  const rs = regions();
  return { xs: [...new Set(rs.map(r => r.x).filter(x => x > 0))], ys: [...new Set(rs.map(r => r.y).filter(y => y > 0))] };
}
const splitName = () => (state.a6 ? 'A6' : state.a5 ? 'A5' : 'A4');

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

// ── 자동 저장과 되돌리기 ──
// 작업 상태 전체(용지, A5 여부, 요소)를 글자로 묶어 브라우저에 저장하고, 되돌리기 기록에도 씁니다.
// 템플릿을 불러온 직후의 요소들. 손대지 않은 템플릿은 작업으로 치지 않아, 다음에 열면 예시 화면이 나옵니다.
let tplCanvas = null;
const snapshot = () => {
  const c = canvas.toObject(EXTRA_PROPS);
  const untouchedTpl = tplCanvas !== null && JSON.stringify(c.objects) === tplCanvas;
  return JSON.stringify({ v: 2, orientation: state.orientation, a5: state.a5, a6: state.a6, pristine: state.pristine, untouchedTpl, canvas: c });
};
const history = { stack: [], index: -1 };
let restoring = false;
let saveTimer;

function persist(snap) {
  try {
    localStorage.setItem(STORE, snap);
  } catch {
    status('사진이 많아 브라우저 자동 저장 공간이 가득 찼어요. 작업 파일로 저장해 두세요.', true);
  }
}
function record() {
  const snap = snapshot();
  if (snap !== history.stack[history.index]) {
    history.stack = history.stack.slice(0, history.index + 1);
    history.stack.push(snap);
    if (history.stack.length > 60) history.stack.shift();
    history.index = history.stack.length - 1;
  }
  persist(snap);
}
function scheduleSave() {
  if (restoring) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(record, 400);
}
function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  record();
}

async function restore(snap) {
  const d = JSON.parse(snap);
  restoring = true;
  try {
    canvas.discardActiveObject();
    state.orientation = d.orientation || 'landscape';
    state.a6 = !!d.a6;
    state.a5 = !state.a6 && !!d.a5;
    state.pristine = !!d.pristine;
    await canvas.loadFromJSON(d.canvas);
    canvas.getObjects().forEach(attachControls);
    await ensureFonts(canvas.getObjects());
    drawPaper();
    fit();
    bgPalette.draw();
    showProps();
    canvas.requestRenderAll();
  } finally {
    restoring = false;
  }
}
async function undo() {
  flushSave();
  if (history.index <= 0) return;
  history.index--;
  await restore(history.stack[history.index]);
  persist(history.stack[history.index]);
}
async function redo() {
  flushSave();
  if (history.index >= history.stack.length - 1) return;
  history.index++;
  await restore(history.stack[history.index]);
  persist(history.stack[history.index]);
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
function attachControls(o) {
  o.controls = { ...o.controls, del: deleteControl };
  // 아이콘은 비율이 깨지지 않게 모서리 손잡이로만 크기를 바꿉니다.
  if (o.isType('Path')) o.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false });
  applyLock(o);
}
// 자리 고정: 옮기기·크기·회전·지우기를 막습니다. 글 내용과 색은 그대로 고칠 수 있습니다.
function applyLock(o) {
  const l = !!o.wdeLock;
  o.set({ lockMovementX: l, lockMovementY: l, lockScalingX: l, lockScalingY: l, lockRotation: l });
  o.setControlVisible('del', !l);
}
canvas.on('object:added', ({ target }) => attachControls(target));

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
// 칸 모양(가로형/세로형)에 맞는 기본 크기를 씁니다. A5 칸은 A4 기준 크기를 칸 폭 비율만큼 줄입니다.
function makeText(key, region = regions()[0], dy = 0) {
  const { text, width, soft, ...p } = PRESETS[key];
  const tall = region.h > region.w;
  const { key: _k, dy: _d, ...over } = STARTER[tall ? 'portrait' : 'landscape'].find(x => x.key === key) || {};
  const k = region.w / (tall ? SIZES.portrait.w : SIZES.landscape.w);
  const fontSize = Math.round((over.fontSize ?? p.fontSize) * k * 10) / 10;
  return new Textbox(text, {
    ...p, ...over, fontSize, width: region.w * width,
    fill: over.fill ?? inkFor(soft, canvas.backgroundColor), textAlign: 'center',
    originX: 'center', originY: 'center', left: region.x + region.w / 2, top: region.y + region.h / 2 + dy * k,
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
  const r = regions()[0];
  const scale = Math.min((r.w * 0.6) / img.width, (r.h * 0.4) / img.height);
  img.set({ isPng, scaleX: scale, scaleY: scale, originX: 'center', originY: 'center', left: r.x + r.w / 2, top: r.y + r.h / 2 });
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

// ── 아이콘 (Material Symbols Sharp) ──
let curated = [];
let allIcons = null;
const iconSvg = d => `<svg viewBox="0 -960 960 960" aria-hidden="true"><path d="${d}"/></svg>`;
function drawIcons(list, hint) {
  $('icon-grid').innerHTML = list.map(({ name, ko, d }) =>
    `<button type="button" data-name="${name}" title="${ko || name}">${iconSvg(d)}<span>${(ko || name).split(' ')[0]}</span></button>`).join('')
    || '<p class="hint">찾는 아이콘이 없어요. 다른 말로 찾아 보세요.</p>';
  $('icon-hint').textContent = hint;
}
const CURATED_HINT = '자주 쓰는 아이콘입니다. 영어로 찾으면 3,900여 개 전체에서 찾습니다. 예) toilet, parking';
$('add-icon').addEventListener('click', async () => {
  if (!curated.length) curated = await (await fetch('icons/curated.json')).json();
  $('icon-search').value = '';
  drawIcons(curated, CURATED_HINT);
  $('icon-dialog').showModal();
  $('icon-search').focus();
});
$('icon-close').addEventListener('click', () => $('icon-dialog').close());
$('icon-dialog').addEventListener('click', e => { if (e.target === $('icon-dialog')) $('icon-dialog').close(); });
let searchTimer;
$('icon-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(async () => {
    const q = $('icon-search').value.trim().toLowerCase();
    if (!q) { drawIcons(curated, CURATED_HINT); return; }
    const mine = curated.filter(i => i.ko.includes(q) || i.name.includes(q.replace(/\s+/g, '_')));
    if (/[가-힣]/.test(q)) { drawIcons(mine, `자주 쓰는 아이콘에서 ${mine.length}개를 찾았어요.`); return; }
    allIcons ??= await (await fetch('icons/all.json')).json();
    const key = q.replace(/\s+/g, '_');
    const more = Object.keys(allIcons).filter(n => n.includes(key) && !mine.some(m => m.name === n)).slice(0, 150)
      .map(name => ({ name, d: allIcons[name] }));
    drawIcons([...mine, ...more], `전체 아이콘에서 ${mine.length + more.length}개를 찾았어요.`);
  }, 150);
});
$('icon-grid').addEventListener('click', e => {
  const b = e.target.closest('button[data-name]');
  if (!b) return;
  const name = b.dataset.name;
  const d = curated.find(i => i.name === name)?.d || allIcons?.[name];
  $('icon-dialog').close();
  addIcon(name, d);
});
function addIcon(name, d) {
  state.pristine = false;
  const r = regions()[0];
  const icon = new Path(d, { fill: inkFor(false, canvas.backgroundColor), iconName: name, originX: 'center', originY: 'center' });
  const k = (r.w / SIZES.landscape.w) * 96 / Math.max(icon.width, icon.height); // A4 가로 기준 약 34mm
  icon.set({ scaleX: k, scaleY: k, left: r.x + r.w / 2, top: r.y + r.h / 2 });
  canvas.add(icon);
  canvas.setActiveObject(icon);
  canvas.requestRenderAll();
}

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

// 글자를 고치는 중에 끌어서 고른 부분. 없으면 null
function textRange() {
  const t = activeText();
  if (!t?.isEditing || t.selectionStart === t.selectionEnd) return null;
  return { t, start: Math.min(t.selectionStart, t.selectionEnd), end: Math.max(t.selectionStart, t.selectionEnd) };
}
const textPalette = palette($('p-color'), () => {
  const r = textRange();
  if (!r) return activeText()?.fill;
  const { lineIndex, charIndex } = r.t.get2DCursorLocation(r.start);
  return r.t.getValueOfPropertyAt(lineIndex, charIndex, 'fill');
}, c => {
  const r = textRange();
  if (!r) {
    // 글 전체 색을 바꾸면, 부분만 바꿨던 색도 함께 지웁니다.
    activeText()?.removeStyle('fill');
    updateText({ fill: c });
    return;
  }
  state.pristine = false;
  r.t.setSelectionStyles({ fill: c }, r.start, r.end);
  r.t.hiddenTextarea?.focus();
  canvas.requestRenderAll();
  scheduleSave();
});
// 색 버튼을 눌러도 고른 글자가 풀리지 않게 합니다.
$('p-color').addEventListener('mousedown', e => { if (e.target.closest('.sw')) e.preventDefault(); });
canvas.on('text:selection:changed', () => textPalette.draw());
canvas.on('text:editing:entered', () => textPalette.draw());
canvas.on('text:editing:exited', () => textPalette.draw());
const fillPalette = palette($('p-fill'), () => active()?.fill, c => {
  const o = active();
  if (!o?.isType('Path')) return;
  state.pristine = false;
  o.set({ fill: c });
  canvas.requestRenderAll();
  scheduleSave();
});

function showProps() {
  const o = active();
  $('props').hidden = !o || o.isType('ActiveSelection');
  if (!o) return;
  const t = activeText();
  $('text-props').hidden = !t;
  $('fill-props').hidden = !o.isType('Path');
  $('a-lock').hidden = o.isType('ActiveSelection');
  $('a-lock').setAttribute('aria-pressed', String(!!o.wdeLock));
  $('a-lock').textContent = o.wdeLock ? '🔓 고정 풀기' : '🔒 자리 고정';
  if (o.isType('Path')) fillPalette.draw();
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
$('a-lock').addEventListener('click', () => {
  const o = active();
  if (!o || o.isType('ActiveSelection')) return;
  o.wdeLock = !o.wdeLock;
  applyLock(o);
  state.pristine = false;
  showProps();
  canvas.requestRenderAll();
  scheduleSave();
});

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
  const c = o.getCenterPoint();
  const r = regionAt(c); // A5 모드에서는 요소가 있는 칸의 가운데로 맞춥니다.
  o.setPositionByOrigin({ x: axis === 'y' ? c.x : r.x + r.w / 2, y: axis === 'x' ? c.y : r.y + r.h / 2 }, 'center', 'center');
  o.setCoords();
  canvas.requestRenderAll();
  scheduleSave();
}
$('c-x').addEventListener('click', () => centerActive('x'));
$('c-y').addEventListener('click', () => centerActive('y'));

// 끌어서 옮길 때 대지(A5 모드면 칸) 가운데 근처에 오면 자석처럼 붙고 안내선이 보입니다.
const guides = { x: null, y: null };
canvas.on('object:moving', ({ target }) => {
  const snap = 8 / canvas.getZoom();
  const c = target.getCenterPoint();
  const xs = [...new Set(regions().map(r => r.x + r.w / 2))];
  const ys = [...new Set(regions().map(r => r.y + r.h / 2))];
  guides.x = xs.find(x => Math.abs(c.x - x) < snap) ?? null;
  guides.y = ys.find(y => Math.abs(c.y - y) < snap) ?? null;
  if (guides.x !== null || guides.y !== null) {
    target.setPositionByOrigin({ x: guides.x ?? c.x, y: guides.y ?? c.y }, 'center', 'center');
  }
});
canvas.on('mouse:up', () => {
  if (guides.x === null && guides.y === null) return;
  guides.x = guides.y = null;
  canvas.requestRenderAll();
});
canvas.on('after:render', ({ ctx }) => {
  const z = canvas.getZoom();
  const { w, h } = size();
  ctx.save();
  ctx.lineWidth = 1;
  // 재단선(화면 표시용)
  const cuts = cutLines();
  if (cuts.xs.length || cuts.ys.length) {
    ctx.strokeStyle = '#8a8a8a';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    cuts.xs.forEach(x => { ctx.moveTo(x * z + 0.5, 0); ctx.lineTo(x * z + 0.5, h * z); });
    cuts.ys.forEach(y => { ctx.moveTo(0, y * z + 0.5); ctx.lineTo(w * z, y * z + 0.5); });
    ctx.stroke();
  }
  // 가운데 안내선
  if (guides.x !== null || guides.y !== null) {
    ctx.strokeStyle = '#ff3b8d';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    const r = regionAt({ x: guides.x ?? w / 2, y: guides.y ?? h / 2 });
    if (guides.x !== null) { ctx.moveTo(guides.x * z + 0.5, r.y * z); ctx.lineTo(guides.x * z + 0.5, (r.y + r.h) * z); }
    if (guides.y !== null) { ctx.moveTo(r.x * z, guides.y * z + 0.5); ctx.lineTo((r.x + r.w) * z, guides.y * z + 0.5); }
    ctx.stroke();
  }
  ctx.restore();
});

// 재단선에 걸친 요소가 있으면 알려 줍니다. 자르면 그 요소가 잘립니다.
function crossesCut(o) {
  const b = o.getBoundingRect();
  const { xs, ys } = cutLines();
  const e = 0.5; // 칸에 꼭 맞춘 요소가 계산 오차로 걸쳐 보이지 않게 둡니다.
  return xs.some(x => b.left < x - e && b.left + b.width > x + e) || ys.some(y => b.top < y - e && b.top + b.height > y + e);
}
function checkCut() {
  const n = canvas.getObjects().filter(crossesCut).length;
  if (n) status(`재단선에 걸친 요소가 ${n}개 있어요. 자르면 잘립니다.`, true);
  else if ($('status').classList.contains('error') && $('status').textContent.startsWith('재단선')) status('');
}
canvas.on('object:modified', checkCut);

$('a-del').addEventListener('click', removeActive);

async function duplicate() {
  const o = active();
  if (!o || o.isType('ActiveSelection')) return;
  const c = await o.clone(EXTRA_PROPS);
  c.set({ left: o.left + 12, top: o.top + 12, wdeLock: false });
  applyLock(c);
  canvas.add(c);
  canvas.setActiveObject(c);
  canvas.requestRenderAll();
}
function removeActive() {
  state.pristine = false;
  const all = canvas.getActiveObjects();
  const objs = all.filter(o => !o.wdeLock);
  if (objs.length < all.length) status('자리 고정한 요소는 지우지 않았어요. 고정을 풀면 지울 수 있어요.');
  objs.forEach(o => { if (o.isEditing) o.exitEditing(); });
  if (!objs.length) return;
  canvas.discardActiveObject();
  objs.forEach(o => canvas.remove(o));
  canvas.requestRenderAll();
}

// 키보드: 지우기, 복제(⌘D), 화살표로 1pt씩(⇧ 누르면 10pt) 옮기기
document.addEventListener('keydown', e => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) || active()?.isEditing;
  if (!typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  const o = active();
  if (!o || o.isEditing || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeActive(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
  const step = e.shiftKey ? 10 : 1;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!d) return;
  e.preventDefault();
  if (o.wdeLock) return;
  state.pristine = false;
  o.set({ left: o.left + d[0], top: o.top + d[1] });
  o.setCoords();
  canvas.requestRenderAll();
  scheduleSave();
});

// ── 용지 방향 ──
function setOrientation(o) {
  if (o === state.orientation) return;
  const before = regions();
  const objs = canvas.getObjects();
  const where = objs.map(obj => regionIndex(obj.getCenterPoint()));
  state.orientation = o;
  if (state.pristine) {
    drawPaper();
    fit();
    rebuildStarter();
    return;
  }
  // 대지(A5 모드면 칸)가 바뀌어도 내용이 같은 칸의 같은 자리에 머물도록 함께 옮깁니다.
  const after = regions();
  objs.forEach((obj, i) => {
    const a = before[where[i]], b = after[where[i]];
    obj.set({ left: obj.left + (b.x + b.w / 2) - (a.x + a.w / 2), top: obj.top + (b.y + b.h / 2) - (a.y + a.h / 2) });
    // 글상자가 칸보다 넓어지면, 폭과 글자 크기를 같은 비율로 줄여 줄바꿈이 그대로 유지되게 합니다.
    if (obj.isType('Textbox') && obj.width > b.w * 0.95) {
      const k = (b.w * 0.85) / obj.width;
      obj.set({ width: obj.width * k, fontSize: Math.round(obj.fontSize * k * 10) / 10 });
    }
    obj.setCoords();
  });
  drawPaper();
  fit();
  checkCut();
  scheduleSave();
}
document.querySelectorAll('#orientation button').forEach(b => b.addEventListener('click', () => setOrientation(b.dataset.o)));

// 용지 영역의 버튼 상태를 지금 값에 맞춥니다.
function drawPaper() {
  document.querySelectorAll('#orientation button').forEach(b => b.setAttribute('aria-pressed', b.dataset.o === state.orientation));
  $('a5').setAttribute('aria-pressed', state.a5);
  $('a6').setAttribute('aria-pressed', state.a6);
  $('a5-tools').hidden = !state.a5 && !state.a6;
  $('mirror').textContent = state.a6 ? '첫 칸 내용을 나머지 칸에도 넣기'
    : state.orientation === 'landscape' ? '왼쪽 내용을 오른쪽에도 넣기' : '위쪽 내용을 아래쪽에도 넣기';
  $('cut-hint').textContent = `A4에 인쇄한 뒤 점선을 따라 자르면 ${state.a6 ? 'A6 네 장' : 'A5 두 장'}이 됩니다. 점선은 PDF에도 들어갑니다.`;
}

// ── A5 두 장 / A6 네 장으로 나누기 ──
// 나누면 첫 칸(나누기 전에는 대지 전체)의 내용을 새 칸 크기에 맞게 줄여 모든 칸에 똑같이 넣습니다.
// 손대지 않은 예시라면 칸 모양에 맞춘 예시로 다시 그립니다. 나누기를 끄면 내용은 그대로 둡니다.
async function setSplit(mode) {
  const before = regions()[0];
  const inFirst = canvas.getObjects().filter(o => regionIndex(o.getCenterPoint()) === 0);
  const others = canvas.getObjects().filter(o => !inFirst.includes(o));
  state.a5 = mode === 'a5';
  state.a6 = mode === 'a6';
  drawPaper();
  if (state.pristine) { await rebuildStarter(); return; }
  if (mode) {
    const after = regions()[0];
    canvas.discardActiveObject();
    others.forEach(o => canvas.remove(o));
    if (inFirst.length) {
      // 내용 전체를 감싸는 상자가 새 칸에 꼭 맞을 만큼 줄입니다. 칸이 줄어든 비율보다 더 줄이지는 않고, 키우지도 않습니다.
      const bs = inFirst.map(o => o.getBoundingRect());
      const box = { x: Math.min(...bs.map(b => b.left)), y: Math.min(...bs.map(b => b.top)) };
      box.w = Math.max(...bs.map(b => b.left + b.width)) - box.x;
      box.h = Math.max(...bs.map(b => b.top + b.height)) - box.y;
      const k = Math.min(1, Math.max(after.w / before.w, after.h / before.h), after.w / box.w, after.h / box.h);
      inFirst.forEach(o => fitInto(o, box, after, k));
    }
    await copyFirstToOthers();
    if (others.length) status('다른 칸에 있던 내용은 첫 칸 내용으로 바뀌었어요. ⌘Z로 되돌릴 수 있어요.');
  }
  canvas.requestRenderAll();
  checkCut();
  scheduleSave();
}
// 요소를 상자 a의 가운데 기준에서 칸 b의 가운데 기준으로 옮기며 k배로 줄입니다. 글상자는 글자 크기와 폭을 줄여 PDF와 화면이 같은 값을 쓰게 합니다.
function fitInto(o, a, b, k) {
  const c = o.getCenterPoint();
  if (o.isType('Textbox')) o.set({ fontSize: Math.round(o.fontSize * k * 10) / 10, width: o.width * k });
  else o.set({ scaleX: o.scaleX * k, scaleY: o.scaleY * k });
  o.setPositionByOrigin({ x: b.x + b.w / 2 + (c.x - (a.x + a.w / 2)) * k, y: b.y + b.h / 2 + (c.y - (a.y + a.h / 2)) * k }, 'center', 'center');
  o.setCoords();
}
$('a5').addEventListener('click', () => setSplit(state.a5 ? null : 'a5'));
$('a6').addEventListener('click', () => setSplit(state.a6 ? null : 'a6'));

// 첫 칸(왼쪽 위)의 내용을 나머지 칸에 똑같이 복사해 넣습니다.
async function copyFirstToOthers() {
  const [a, ...rest] = regions();
  const src = canvas.getObjects().filter(o => regionIndex(o.getCenterPoint()) === 0);
  for (const b of rest) {
    for (const o of src) {
      const c = await o.clone(EXTRA_PROPS);
      c.set({ left: o.left + (b.x - a.x), top: o.top + (b.y - a.y) });
      canvas.add(c);
    }
  }
}

// 첫 칸의 내용을 나머지 칸에 똑같이 넣습니다. 나머지 칸에 있던 내용은 바뀝니다.
$('mirror').addEventListener('click', async () => {
  const inA = o => regionIndex(o.getCenterPoint()) === 0;
  const src = canvas.getObjects().filter(inA);
  const old = canvas.getObjects().filter(o => !inA(o));
  if (!src.length) { status('첫 칸에 넣을 내용이 없어요.', true); return; }
  if (old.length && !(await ask('나머지 칸의 내용을 지우고 첫 칸 내용으로 바꿀까요? 되돌리기(⌘Z)로 다시 돌릴 수 있어요.', '바꾸기'))) return;
  state.pristine = false;
  canvas.discardActiveObject();
  old.forEach(o => canvas.remove(o));
  await copyFirstToOthers();
  canvas.requestRenderAll();
  checkCut();
  scheduleSave();
});

// ── PDF 저장 ──
function fileName() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const texts = canvas.getObjects().filter(o => o.isType('Textbox') && o.text.trim());
  const main = texts.sort((a, b) => b.fontSize - a.fontSize)[0];
  const title = (main?.text || '출력물').replace(/\s+/g, '').replace(/[\\/:*?"<>|]/g, '').slice(0, 20);
  return `${ymd}_${title}_${splitName()}.pdf`;
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
    const bytes = await buildPdf(canvas, size(), { cuts: cutLines() });
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

// ── 작업 파일: 나중에 이어서 고칠 수 있게 지금 상태를 .json 파일로 저장하고 엽니다 ──
// 템플릿도 같은 파일입니다. 디자이너가 저장한 작업 파일을 templates 폴더에 올리면 템플릿이 됩니다.
const WORK_APP = 'waverock-design-editor';
$('save-work').addEventListener('click', () => {
  canvas.discardActiveObject();
  canvas.requestRenderAll();
  const doc = { app: WORK_APP, ...JSON.parse(snapshot()), pristine: false };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(doc)], { type: 'application/json' }));
  a.download = fileName().replace(/\.pdf$/, '.json');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  status(`${a.download} 저장했어요. 작업 파일 열기로 이어서 고칠 수 있어요.`);
});
$('open-work').addEventListener('click', () => $('work-file').click());
$('work-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    await openDoc(JSON.parse(await file.text()), `${file.name}을(를) 열었어요.`);
  } catch (err) {
    console.error(err);
    status('이 파일은 열 수 없어요. 디자인 에디터에서 저장한 작업 파일(.json)인지 확인해 주세요.', true);
  }
});
async function openDoc(doc, done, isTemplate = false) {
  if (doc?.app !== WORK_APP || !doc.canvas) throw new Error('작업 파일이 아님');
  await restore(JSON.stringify({ ...doc, pristine: false }));
  tplCanvas = isTemplate ? JSON.stringify(canvas.toObject(EXTRA_PROPS).objects) : null;
  record();
  status(done);
}

// ── 템플릿 ──
// templates/index.json 목록을 읽어 버튼으로 보여 줍니다. 목록이 비어 있으면 칸을 숨깁니다.
(async function loadTemplates() {
  let list = [];
  try { list = await (await fetch('templates/index.json', { cache: 'no-cache' })).json(); } catch { return; }
  if (!Array.isArray(list) || !list.length) return;
  $('tpl-list').innerHTML = list.map((t, i) =>
    `<button type="button" data-i="${i}">${t.thumb ? `<img src="templates/${encodeURI(t.thumb)}" alt="">` : ''}<span>${esc(t.name)}<small>${t.note ? esc(t.note) : ''}</small></span></button>`).join('');
  $('tpl-sec').hidden = false;
  $('tpl-list').addEventListener('click', async e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const t = list[b.dataset.i];
    if (!state.pristine && !(await ask(`'${t.name}' 템플릿으로 바꿀까요? 지금 작업은 되돌리기(⌘Z)로 다시 돌릴 수 있어요.`, '템플릿으로 바꾸기'))) return;
    try {
      const doc = await (await fetch(`templates/${encodeURI(t.file)}`, { cache: 'no-cache' })).json();
      await openDoc(doc, `'${t.name}' 템플릿을 불러왔어요. 글을 클릭해서 고쳐 쓰세요.`, true);
    } catch (err) {
      console.error(err);
      status('템플릿을 불러오지 못했어요.', true);
    }
  });
})();
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ── 확인 창 ──
function ask(text, okLabel) {
  const d = $('confirm');
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = okLabel;
  d.returnValue = '';
  d.showModal();
  return new Promise(res => d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true }));
}

// ── 새로 시작 ──
$('reset').addEventListener('click', async () => {
  if (!(await ask('지금 작업한 내용을 모두 지우고 새로 시작할까요? 되돌리기(⌘Z)로 다시 돌릴 수 있어요.', '지우고 새로 시작'))) return;
  canvas.discardActiveObject();
  canvas.backgroundColor = '#ffffff';
  bgPalette.draw();
  await rebuildStarter();
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
// A5 모드면 두 칸 모두에 칸 크기에 맞춘 예시를 넣습니다.
async function starter() {
  const objs = regions().flatMap(r => {
    const tall = r.h > r.w;
    return STARTER[tall ? 'portrait' : 'landscape'].map(({ key, dy }) => makeText(key, r, dy));
  });
  await ensureFonts(objs);
  canvas.add(...objs);
  state.pristine = true;
}
async function rebuildStarter() {
  tplCanvas = null;
  canvas.discardActiveObject();
  canvas.remove(...canvas.getObjects());
  await starter();
  status('');
  scheduleSave();
}

// ── 시작 ──
(async function init() {
  fit();
  const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
  // 손대지 않은 예시나 템플릿만 있었다면 예시 화면으로 시작합니다. 직접 작업한 내용이 있으면 그 내용을 엽니다.
  if (saved?.canvas && !saved.pristine && !saved.untouchedTpl) {
    await restore(JSON.stringify(saved));
  } else {
    // 손대지 않은 예시만 있었다면 저장된 용지 설정으로 최신 예시를 다시 그립니다.
    state.orientation = saved?.orientation || 'landscape';
    state.a6 = !!saved?.a6;
    state.a5 = !state.a6 && !!saved?.a5;
    drawPaper();
    fit();
    await starter();
  }
  canvas.requestRenderAll();
  record(); // 되돌리기의 출발점
  window.__wde = { canvas, size, state }; // 확인용
})();
