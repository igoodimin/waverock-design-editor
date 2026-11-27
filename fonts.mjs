// 에디터에서 고를 수 있는 글꼴. 화면은 웹폰트로, PDF는 같은 글꼴 파일을 넣어 만듭니다.
const GMARKET = 'https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2001@1.1/';

export const FONTS = {
  Pretendard: {
    label: 'Pretendard (한글·영문)',
    weights: { 400: '보통', 500: '중간', 600: '약간 굵게', 700: '굵게', 800: '더 굵게', 900: '가장 굵게' },
    file: w => `fonts/Pretendard-${{ 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' }[w]}.ttf`,
  },
  GmarketSans: {
    label: 'G마켓 산스 (한글·영문)',
    weights: { 300: '얇게', 500: '보통', 700: '굵게' },
    file: w => `${GMARKET}GmarketSans${{ 300: 'Light', 500: 'Medium', 700: 'Bold' }[w]}.woff`,
  },
  'Bebas Neue': {
    label: 'Bebas Neue (영문 강조)',
    weights: { 400: '기본' },
    file: () => 'fonts/BebasNeue-Regular.ttf',
  },
  Anton: {
    label: 'Anton (영문 강조)',
    weights: { 400: '기본' },
    file: () => 'fonts/Anton-Regular.ttf',
  },
};

// 고른 굵기가 그 글꼴에 없으면 가장 가까운 굵기로 바꿉니다.
export function nearestWeight(family, weight) {
  const ws = Object.keys(FONTS[family]?.weights || { 400: '' }).map(Number);
  const w = Number(weight) || 400;
  return ws.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
}

// 화면에서 쓰기 전에 웹폰트를 내려받아 둡니다. 안 그러면 줄바꿈이 다른 글꼴 기준으로 계산됩니다.
export async function loadWebFont(family, weight, text = '가A') {
  try {
    await document.fonts.load(`${weight} 40px "${family}"`, text);
  } catch { /* 글꼴을 못 받아도 편집은 계속합니다 */ }
}

// PDF에 넣을 글꼴 파일. 한 번 받은 파일은 다시 받지 않습니다.
const bytesCache = new Map();
export function fontBytes(family, weight) {
  const url = FONTS[family].file(nearestWeight(family, weight));
  if (!bytesCache.has(url)) {
    bytesCache.set(url, fetch(url).then(r => {
      if (!r.ok) throw new Error(`글꼴 파일을 받지 못했어요 (${family})`);
      return r.arrayBuffer();
    }).catch(e => { bytesCache.delete(url); throw e; }));
  }
  return bytesCache.get(url);
}
