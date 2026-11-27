# WAVEROCK 디자인 에디터

스태프가 A4 공지문을 직접 만들고, 버튼 한 번으로 인쇄용 PDF를 받는 에디터입니다.

- 글꼴: Pretendard, G마켓 산스, Bebas Neue, Anton
- 용지: A4 세로·가로
- PDF: 글자는 벡터로 들어가 인쇄해도 선명합니다. 사진은 인쇄 크기 기준 300dpi로 넣습니다.
- 작업 중인 내용은 브라우저에 자동 저장됩니다.

## 파일

| 파일 | 하는 일 |
| --- | --- |
| `index.html`, `style.css` | 화면. 디자인 툴 공통 `ui.css`를 불러옵니다. |
| `app.mjs` | 편집 화면(Fabric.js), 왼쪽 설정 영역, 자동 저장 |
| `fonts.mjs` | 고를 수 있는 글꼴과 굵기 목록 |
| `pdf.mjs` | PDF 만들기(pdf-lib). 화면에서 계산한 글자 위치를 그대로 옮깁니다. |
| `subset.mjs` | PDF에 넣을 글꼴에서 쓴 글자만 골라내기(HarfBuzz) |
| `vendor/` | 라이브러리: Fabric.js 6.9.1, pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1, harfbuzzjs 1.6.4 |
| `fonts/` | PDF에 넣는 글꼴 파일 |

## 로컬 실행

```bash
python3 -m http.server 5190
```

브라우저에서 http://localhost:5190 을 엽니다.
