# LH 입찰공고 15159012 — 실응답 녹음 (가린 응답)

이 폴더의 파일은 **실제 API 응답**을 가려 저장한 녹음이다. 사람이 만든 합성 응답은 `fixtures/synthetic/15159012/` 에 따로 있고, 두 폴더의 파일을 섞지 않는다.

| 파일 | 요청 | 받은 때 | 결과 |
|---|---|---|---|
| `getOpenBidInfo.20261026.p1.masked.json` | `getOpenBidInfo`, 등록일 2026-10-26 하루, 1쪽, 10행 | 2026-10-27 15:47 KST(`fetchedAt 2026-10-27T06:47:18.641Z`) | HTTP 200, `text/xml;charset=EUC-KR`, `resultCode 00`, `totalCount 12`, 항목 10 |

- 녹음 스크립트: `scripts/recorded/record-lh-bid-notice.mjs`(커밋 `602d7c2d`, charset 대로 읽는 판). 형식 `sol-external-recorded/v0.1`.
- 파일 sha256 `d0db121ebc971ba2e9f5962d757eb1f9e19cf5623cb8dd67325e308ad7703daf`, 원본 바이트 sha256(`rawSha256`) `81971ca5c9af2b9abee5282afacc53cb552c7f255c17010bbc7451986c74e05f`.
- 가림: 키 흔적·명세 밖 태그·담당자 태그는 `***`, 이메일·전화는 같은 길이 `*`. 이 응답에는 가릴 칸이 없었다(`maskedFields: []`). 응답에 담당자·연락처 칸이 없다.
- 흔적 검사: 회사 서버에서 키 형태 6가지·값이 붙은 `serviceKey=`·이메일 0건(사용자 실행), 개발 PC 에서 이메일·전화·주민번호·사업자번호·깨진 글자(`U+FFFD`)·URL 0건.
- 같은 날 15:13 KST 의 첫 녹음은 넣지 않았다. 스크립트가 EUC-KR 응답을 UTF-8 로 읽어 한글이 `U+FFFD` 1,016자로 깨졌다. 회사 서버 `/tmp/sol-lh-rec/out-1` 에만 남아 있다.
- 쓰는 곳: `web/server/ingestion/lh-bid-notice.test.ts` 의 실응답 재생 시험. 이 녹음을 고치거나 값을 지어 넣지 않는다. 다시 녹음하면 새 파일로 더하고 이 표에 적는다.
- 증거: `docs/evidence/ingestion/20261027-lh-bid-notice/first-call.md`, `normalization-check.md`.
