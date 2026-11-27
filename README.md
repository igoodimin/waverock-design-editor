# WAVEROCK 디자인 에디터

스태프가 A4 공지문을 직접 만들고, 버튼 한 번으로 인쇄용 PDF를 받는 에디터입니다.

- 글꼴: Pretendard, G마켓 산스, Bebas Neue, Anton
- 용지: A4 세로·가로
- PDF: 글자는 벡터로 들어가 인쇄해도 선명합니다. 사진은 인쇄 크기 기준 300dpi로 넣습니다.
- A5 나누기: A4 한 장을 반으로 잘라 A5 두 장을 만듭니다. 재단선(점선)이 PDF에도 들어갑니다.
- 아이콘: Material Symbols Sharp(각진 아이콘, Apache-2.0). 자주 쓰는 77개는 한국어로 찾고, 전체 3,900여 개는 영어로 찾습니다.
- 되돌리기(⌘Z)·다시 하기(⇧⌘Z), 자리 고정
- 작업 중인 내용은 브라우저에 자동 저장됩니다. 작업 파일(.json)로 저장하고 다시 열 수도 있습니다.
- 인스타 피드 PNG(1080×1350)는 잠겨 있습니다. 화면 위 제목 '디자인 에디터'를 2초 안에 5번 누르면 열리고, 다시 5번 누르면 잠깁니다.

## 템플릿 추가하기 (디자이너용)

1. 에디터에서 템플릿으로 쓸 화면을 만듭니다. 움직이면 안 되는 요소는 **자리 고정**을 눌러 둡니다.
2. 왼쪽 아래 **작업 파일 저장**을 누릅니다.
3. 받은 `.json` 파일을 `templates/` 폴더에 영어 이름으로 넣습니다. 예: `event-portrait.json`
4. (선택) 미리보기 그림(PNG, 가로 240px 정도)을 같은 폴더에 넣습니다.
5. `templates/index.json`에 한 줄을 더합니다.

```json
{ "name": "행사 안내", "note": "A4 세로", "file": "event-portrait.json", "thumb": "event-portrait.png" }
```

6. 커밋하고 푸시하면 1~2분 뒤 에디터 왼쪽 **템플릿** 칸에 나타납니다.

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
| `icons/` | 아이콘 모양 데이터. `curated.json`(한국어 이름 붙인 자주 쓰는 아이콘), `all.json`(전체) |
| `templates/` | 템플릿 목록(`index.json`)과 템플릿 파일 |

## 로컬 실행

```bash
python3 -m http.server 5190
```

브라우저에서 http://localhost:5190 을 엽니다.
