// PDF에 넣을 글꼴에서 실제로 쓴 글자만 골라 작은 글꼴 파일로 만듭니다(HarfBuzz).
// pdf-lib 자체의 글자 고르기 기능은 한글 일부를 빠뜨려서 쓰지 않습니다.
let hbPromise;
function harfbuzz() {
  hbPromise ??= fetch(new URL('./vendor/hb-subset.wasm', import.meta.url))
    .then(r => r.arrayBuffer())
    .then(b => WebAssembly.instantiate(b))
    .then(r => r.instance.exports);
  return hbPromise;
}

// WOFF(웹폰트 압축 형식)를 일반 글꼴 파일(TTF/OTF)로 풉니다.
export async function unwoff(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0) !== 0x774f4646) return bytes; // 'wOFF'가 아니면 그대로
  const flavor = v.getUint32(4);
  const n = v.getUint16(12);
  const tables = [];
  for (let i = 0; i < n; i++) {
    const p = 44 + i * 20;
    tables.push({ tag: v.getUint32(p), off: v.getUint32(p + 4), comp: v.getUint32(p + 8), orig: v.getUint32(p + 12), sum: v.getUint32(p + 16) });
  }
  for (const t of tables) {
    const raw = bytes.subarray(t.off, t.off + t.comp);
    t.data = t.comp < t.orig
      ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
      : raw;
  }
  const pad = x => (x + 3) & ~3;
  let size = 12 + 16 * n;
  tables.forEach(t => { size += pad(t.orig); });
  const out = new Uint8Array(size);
  const o = new DataView(out.buffer);
  const es = Math.floor(Math.log2(n));
  o.setUint32(0, flavor);
  o.setUint16(4, n);
  o.setUint16(6, 16 * 2 ** es);
  o.setUint16(8, es);
  o.setUint16(10, n * 16 - 16 * 2 ** es);
  let off = 12 + 16 * n;
  tables.forEach((t, i) => {
    const p = 12 + i * 16;
    o.setUint32(p, t.tag);
    o.setUint32(p + 4, t.sum);
    o.setUint32(p + 8, off);
    o.setUint32(p + 12, t.orig);
    out.set(t.data, off);
    off += pad(t.orig);
  });
  return out;
}

export async function subsetFont(buffer, text) {
  const bytes = await unwoff(new Uint8Array(buffer));
  const e = await harfbuzz();
  const mem = () => new Uint8Array(e.memory.buffer);
  const ptr = e.malloc(bytes.length);
  mem().set(bytes, ptr);
  const blob = e.hb_blob_create(ptr, bytes.length, 1 /* 읽기 전용 */, 0, 0);
  const face = e.hb_face_create(blob, 0);
  e.hb_blob_destroy(blob);
  const input = e.hb_subset_input_create_or_fail();
  const unicodes = e.hb_subset_input_unicode_set(input);
  for (const ch of new Set(text)) e.hb_set_add(unicodes, ch.codePointAt(0));
  const sub = e.hb_subset_or_fail(face, input);
  e.hb_subset_input_destroy(input);
  try {
    if (!sub) throw new Error('글꼴에서 글자를 골라내지 못했어요');
    const outBlob = e.hb_face_reference_blob(sub);
    const data = e.hb_blob_get_data(outBlob, 0);
    const len = e.hb_blob_get_length(outBlob);
    const result = mem().slice(data, data + len);
    e.hb_blob_destroy(outBlob);
    return result;
  } finally {
    if (sub) e.hb_face_destroy(sub);
    e.hb_face_destroy(face);
    e.free(ptr);
  }
}
