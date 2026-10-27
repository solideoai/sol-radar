---
title: "첨부 파서 실표본 확인 (2026-10-27)"
status: draft
tags:
  - sol-radar
  - ai
  - pipeline
updated: 2026-10-27
---

# 첨부 파서 실표본 확인 (2026-10-27)

사용자 결정(2026-10-27 "첨부 처리를 구현해 실공고 분석 경로를 완성") 중 AI gateway `/parse` 파서 몫이다. 브랜치 `feat/attachment-parse`(기준 main `43e4e024`). `/parse` 요청·응답 계약(`ParseResult` 필드·상태 값·사유 코드)은 바꾸지 않았다([[03-AI-PIPELINE|03]] §10.1).

## 구현 요약

- 위치: `services/ai/src/sol_ai/parsers/`(`pdf.py`·`hwpx.py`·`hwp.py`, 공통 `document.py`, 격리 진입점 `worker.py`), 실행·형식 판정 `services/ai/src/sol_ai/parse.py`.
- 형식은 매직 바이트로만 판정한다(기존 `detect_format` 그대로). 확장자·Content-Type 은 보지 않는다.
- 어댑터는 요청마다 **격리 하위 프로세스**(`python -I`, 빈 환경 변수, stderr 버림)에서 돈다. 처리 시간 상한을 넘기면 프로세스를 죽이고 `FAILED`+`PARSER_ERROR`(`PARSE_TIMEOUT`)다. 동시 실행은 2개.
- env `PARSER_PDF`·`PARSER_HWPX`·`PARSER_HWP` 를 비우면 기본 어댑터(`pdfplumber`·`sol-hwpx`·`sol-hwp5`)를 쓴다. 모르는 값이면 그 형식만 기존처럼 `UNSUPPORTED`+`UNSUPPORTED_FORMAT`+`PARSER_NOT_CONFIGURED:<fmt>`, `/health` 의 `parserId` 는 null 이다.
- `text` 는 블록마다 `norm`(15 §5.1)을 적용해 공백 하나로 잇는다. 표는 행 사이 공백, 셀 사이 ` | `. 빈 셀도 자리를 남기되 공백이 겹치지 않게 써서 `norm(text) == text` 다. `blocks` 의 문단·표·셀 `charStart/charEnd` 는 이 `text` 기준이다.
- 칸이 하나뿐인 표(안내 상자·쪽 테두리)는 표가 아니라 안의 문단으로 편다. 머리말·꼬리말(HWP `head`·`foot`, HWPX `header`·`footer`)은 본문에서 뺀다.

## 라이브러리·라이선스

|패키지|버전|라이선스|용도|
|---|---|---|---|
|pdfplumber|0.11.10|MIT|PDF 글자·선·표 셀|
|pdfminer.six|20260107|MIT|pdfplumber 의존(PDF 해석)|
|pypdfium2|5.14.0|Apache-2.0 또는 BSD-3-Clause(동봉 PDFium·freetype·libjpeg-turbo·openjpeg·lcms·libpng·zlib·ICU 등 허용 라이선스)|pdfplumber 의존. `/parse` 경로에서는 import 하지 않는다(그림 렌더링 전용)|
|Pillow|13.0.0|MIT-CMU|pdfplumber 의존. `/parse` 경로에서는 import 하지 않는다|
|cryptography|50.0.2|Apache-2.0 또는 BSD-3-Clause|pdfminer.six 의존(암호화 PDF 해독)|
|cffi 2.1.1 · pycparser 3.12 · charset-normalizer 3.5.2|—|MIT-0 · BSD-3-Clause · MIT|간접 의존|
|olefile|0.47|BSD-2-Clause|HWP 5.0 OLE 복합 문서|
|(표준 라이브러리) zipfile·zlib·xml.parsers.expat|Python 3.12|PSF|HWPX zip·XML, HWP 본문 압축 해제|

- AGPL·GPL 패키지 없음(PyMuPDF·pyhwp·poppler·ghostscript 미사용, pdfplumber `repair` 미사용). pypdfium2 동봉 ICU 라이선스 파일에 GPL 문구가 있으나 ICU 빌드 스크립트(autoconf 예외 조항)에 대한 고지다.
- HWPX 는 [[03-AI-PIPELINE|03]] §10.2 1순위 후보 python-hwpx(Apache-2.0, lxml 의존) 대신 표준 라이브러리로 직접 읽었다. 의존성이 없고 DTD·엔티티 거부를 직접 강제할 수 있어서다.
- HWP 5.0 은 03 §10.2 후보(kordoc·rhwp-python)가 Node·Rust 런타임을 요구해 olefile + 자체 레코드 해석으로 했다. 해석 규칙은 한글과컴퓨터 공개 "HWP 5.0 파일 구조" 문서의 FileHeader 속성·레코드 머리·PARA_TEXT 제어 문자·표(LIST_HEADER 셀 주소) 정의다.

## 형식별 지원 판정

|형식|판정|근거|
|---|---|---|
|PDF(텍스트 레이어)|PARSED. 품질 신호에 걸리면 PARTIAL|합성 시험 + 실표본 2건 PARSED, 표 셀 보존. 같은 문서 HWP 와 교차 확인(아래)|
|HWPX|PARSED. 품질 신호에 걸리면 PARTIAL|합성 시험 + 실표본 2건 PARSED, 표 셀·병합 주소 보존|
|HWP 5.0|PARSED. 품질 신호에 걸리면 PARTIAL|합성 시험(바이트 단위 레코드·OLE) + 실표본 2건 PARSED, 표 셀·병합 주소 보존|
|스캔 PDF(글자 0)|UNSUPPORTED `NO_TEXT_LAYER`|합성 시험. OCR 하지 않음|
|HWP 열기 암호·DRM|UNSUPPORTED `ENCRYPTED`|FileHeader 속성 비트 1·4·8·10. 합성 시험|
|HWP 배포용|UNSUPPORTED `DISTRIBUTION_PROTECTED`|속성 비트 2 또는 본문이 ViewText 에만 있음. 합성 시험. 복호화하지 않음|
|HWPX zip 암호·manifest `encryption-data`|UNSUPPORTED `ENCRYPTED`|코드만 있음. 실표본·시험 없음|
|PDF 열기 암호|UNSUPPORTED `ENCRYPTED`|pdfminer `PDFEncryptionError` 매핑. 실표본·시험 없음. 소유자 암호만 있는 PDF 는 그대로 읽음|
|손상 파일|FAILED `CORRUPTED`|세 형식 합성 시험|
|xlsx·zip·docx 등|UNSUPPORTED `UNSUPPORTED_FORMAT`|이번 범위 밖, 기존 그대로|

PARTIAL 품질 신호([[03-AI-PIPELINE|03]] §10.4 초기값): 쪽당 글자 수 중앙값 200 미만(PDF), 대체 문자(`U+FFFD`) 1% 초과, 같은 접두어 요구사항 번호(`ABC-001` 꼴, 3개 이상·촘촘할 때)의 빈 번호, `<표` 캡션이 있는데 표 0개, 빈 셀 50% 초과, `text` 200만 자 초과로 자름, PDF 300쪽 초과(`PAGE_LIMIT:300`)·쪽 오류(`PAGE_ERROR:<n>`). 사유는 `warnings` 와 `quality.partialReasons` 에 같이 남긴다.

> [!warning] §10.4 초기값 조정 1건
> 빈 셀 50% 초과 신호를 **PDF 에만** 적용했다. HWP·HWPX 는 셀 구조를 원문 그대로 읽으므로 빈 셀은 서식의 기입란이다. 실표본 hwp-2(59.7%)·hwpx-2(87.0%)가 이 신호만으로 PARTIAL 이 되었는데, 두 문서 모두 같은 내용의 PDF·원문과 대조해 빠진 글자가 없었다(아래 교차 확인). 값은 `quality.emptyCellRatio` 에 그대로 남긴다.

## 실표본 결과

g2b 공개 첨부 6건을 익명 GET 으로 받았다(2026-10-27, 6건 모두 HTTP 200, 리다이렉트 0회. HWP·HWPX 4건은 `application/octet-stream`, PDF 2건은 `application/pdf`). 파일은 저장소 밖 임시 폴더에만 두었다. 처리 시간은 격리 프로세스 기동을 포함한 `/parse` 1건 시간(Apple Silicon 로컬, 2회 측정 범위)이다.

|id|공고·첨부|크기|형식|결과|글자 수|쪽|표/셀|빈 셀|대체 문자|사용자 정의 영역 글자|norm 안정|시간|
|---|---|---|---|---|---|---|---|---|---|---|---|---|
|hwp-1|R26BK01790653 #3|275,968 B|HWP 5.0|PARSED|18,340|—|14 / 268|9.7%|0|0|예|146~215 ms|
|hwp-2|R26BK01789921 #1|115,200 B|HWP 5.0|PARSED|17,103|—|14 / 524|59.7%|0|0|예|185~194 ms|
|hwpx-1|R26BK01790653 #5|35,895 B|HWPX|PARSED|218|—|1 / 15|26.7%|0|0|예|148~188 ms|
|hwpx-2|R26BK01789896 #1|400,687 B|HWPX|PARSED|13,635|—|1 / 23|87.0%|0|0|예|145~155 ms|
|pdf-1|R26BK01790653 #1|213,183 B|PDF 1.6|PARSED|8,568|9|9 / 66|12.1%|0|0.21%|예|753~819 ms|
|pdf-2|R26BK01789921 #4|351,326 B|PDF 1.6|PARSED|17,299|22|21 / 506|49.0%|0|0|예|1,561~1,687 ms|

- 6건 모두 `PARSED`, 셀 오프셋으로 자른 글자가 셀 내용과 같았다(앞뒤 공백 없음). 쪽당 글자 수 중앙값 pdf-1 1,075·pdf-2 830.5.
- 처리 시간: HWP·HWPX 는 대부분 프로세스 기동(약 0.15 s)이다. PDF 는 쪽당 약 0.07 s 로, 300쪽 상한이면 20 s 안팎이다. 처리 시간 상한은 90 s.
- 표: hwpx-2 의 `hp:tbl` 10개 중 9개는 1×1 안내 상자라 문단으로 폈고 6×5 표 1개만 표 블록이다. hwp-1·hwp-2 는 평가 기준표·급식 현황표·제출 서류표가 행·열·병합 주소와 함께 남았다.
- 사용자 정의 영역 글자: pdf-1 의 평점 산식 자리(`평점 = ` 뒤) 18자가 기호 글꼴의 `U+F000` 으로 나왔다. 산식 자체는 읽히지 않는다(대체 문자 신호에는 걸리지 않음).

짧은 예시(형식마다 한 줄):

- PDF(pdf-1): `③ 추정금액 : 4,826,703,200원(VAT 포함)`
- HWP(hwp-2 표 한 행): `구분 | 예상 급식인원(명) | 예상 급식일수(일) | 비고`
- HWPX(hwpx-2): `ᆞ입찰공고번호 : R26BK01789896-000`

### 같은 문서 HWP ↔ PDF 교차 확인

R26BK01789921 의 #1(HWP)과 #4(PDF)는 같은 공고서다.

|지표|값|
|---|---|
|HWP 낱말(2자 이상) 중 PDF 에도 있는 비율|0.980|
|PDF 낱말 중 HWP 에도 있는 비율|0.957|
|금액 문자열(`1,234` 꼴)|양쪽 같음(1건 중 1건)|
|"참가자격" 출현 수|HWP 17 · PDF 17|

PDF 쪽 차이는 줄 끝에서 끊긴 낱말이 공백으로 이어지는 것이다(예: `깨끗 한`). 같은 표의 "중식" 칸은 PDF 에 테두리 선이 없어 셀로 잡히지 않았는데, 선이 빠진 격자 칸을 셀로 채우는 처리로 `(2, 0)` 셀에 들어간다(수정 전에는 글자가 빠졌다).

## 안전 상한

|항목|값|넘을 때|
|---|---|---|
|요청 본문|50 MB(기존)|UNSUPPORTED `TOO_LARGE`|
|zip 항목 수|5,000|UNSUPPORTED `TOO_LARGE`(`ZIP_ENTRY_LIMIT`)|
|압축 해제 총량(HWPX 섹션 XML·HWP 본문)|200 MiB, 선언 크기 합과 실제 풀린 양 모두|UNSUPPORTED `TOO_LARGE`(`UNPACKED_LIMIT`)|
|XML DTD·엔티티 선언|즉시 거부(expat 처리기)|FAILED `CORRUPTED`(`XML_DTD_REJECTED`)|
|중첩(표·글상자·HWP 레코드 수준)|64 / XML 요소 깊이 1,000|FAILED `CORRUPTED`(`NESTING_LIMIT`)|
|PDF 쪽 수|300|앞 300쪽만 읽고 PARTIAL(`PAGE_LIMIT:300`)|
|`text` 길이|2,000,000자(/extract 첨부 상한과 같음)|블록 경계에서 자르고 PARTIAL(`TEXT_TRUNCATED`). 첫 블록부터 넘으면 UNSUPPORTED `TOO_LARGE`(`TEXT_LIMIT`)|
|처리 시간|90 s|프로세스 종료, FAILED `PARSER_ERROR`(`PARSE_TIMEOUT`)|
|파서 프로세스 메모리|2 GiB 주소 공간(Linux)|프로세스 종료, FAILED `PARSER_ERROR`(`PARSER_EXIT:<코드>`)|
|동시 파서 프로세스|2|차례 대기|

## 시험

`services/ai/tests/test_parse.py`(합성 문서는 `tests/documents.py` 가 바이트로 만든다):

- 형식별 성공: PDF·HWPX·HWP 5.0 각각 문단 + 표(빈 셀이 맨 앞·행 끝에 있는 3×2)의 `text`·셀 오프셋·`norm(text) == text`. HWP 는 탭·줄바꿈·확장 제어(8 WCHAR)와 머리말 제외를 함께 본다. 형식 판정은 일부러 틀린 파일 이름·Content-Type 으로 보낸다.
- 거절: HWP 암호·배포용, 스캔 PDF, 세 형식 손상 파일, HWPX DTD·엔티티, zip 압축 폭탄(작은 상한), 처리 시간 초과 시 프로세스 종료, 모르는 `PARSER_PDF` 값.
- 변형 확인: 확장 제어 길이를 1로 바꾸면 HWP 시험, 머리말 제외를 끄면 HWPX 시험, 표 맨 앞 빈 셀 처리(`length == 0`)를 되돌리면 HWP·HWPX 시험이 실패했다.

## 남은 일·미검증

> [!warning] 미검증 가정
> - [[03-AI-PIPELINE|03]] §10.3 의 사람 작성 기준표(형식마다 10건 이상, 자격 조항·요구사항 번호 재현율)는 아직 없다. 이번 표본 6건은 감리·급식·상담 용역이라 `SFR-001` 꼴 요구사항 번호가 없어 번호 연속성 신호는 실표본으로 확인하지 못했다.
> - 배포용·암호 HWP, 암호 PDF, 암호 HWPX 실표본은 없다. HWP 는 속성 비트로 판정하는 합성 시험만 있다.
> - HWP·HWPX 의 개요·문단 자동 번호(예: `1.` `가.` 가 서식으로 붙는 경우)는 본문 글자가 아니라 나오지 않는다. 손으로 친 번호는 남는다.
> - PDF 는 줄바꿈 낱말 사이에 공백이 생기고, 기호 글꼴 산식은 사용자 정의 영역 글자로 나온다.
> - 운영 첨부 1,975건(hwpx 697·pdf 650·hwp 449) 단위의 PARSED·PARTIAL·UNSUPPORTED·FAILED 비율([[03-AI-PIPELINE|03]] §10.6)은 documents worker 연결 뒤에 잰다.

## 관련 문서

- [[03-AI-PIPELINE|03 AI 파이프라인]] §10
- [[15-DATA-CONTRACTS|15 데이터 계약]] §5.1
- [[09-SECURITY|09 보안]]
- [[external-deps|P0-0 외부 의존성 점검]] ②·④
