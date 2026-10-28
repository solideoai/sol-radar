# K-water 입찰공고 15101635 — 실응답 녹음 (가린 응답)

이 폴더의 파일은 **실제 API 응답**을 가려 저장한 녹음이다. 사람이 만든 합성 값을 섞지 않는다.

| 파일 | 요청 | 받은 때 | 결과 |
|---|---|---|---|
| `servcList.202610.p1.masked.json` | `servcList`(용역), `searchDt=202610`, 1쪽, 100행, `_type=json` | 2026-10-28 12:18 KST(`fetchedAt 2026-10-28T03:18:57.801Z`) | HTTP 200, `application/json;charset=UTF-8`, `resultCode 00`, `totalCount 147`, 항목 100 |

- 녹음 스크립트: `scripts/recorded/record-datagokr.mjs`(커밋 `ad61c4b9`, 회사 서버로 보낸 파일 sha256 `ccdba976…`). 형식 `sol-external-recorded/v0.1`.
- 파일 sha256 `b4f8a0917c09793bbec268230f10afaac91853ec3ce0276ea9d52fb98420f2eb`(저장소 서식에 맞춰 `maskedFields` 줄바꿈만 바꿨다. 회사 녹음 파일은 `5ce54087…`, JSON 값은 같다), 원본 바이트 sha256(`rawSha256`) `3901c648d6a9f16f82ad7b12681b7a3f2f72b98b143692d3e62e19342b48c6c9`.
- 가림: 담당자(`intnChargerNm`)는 `***`. 명세 밖 칸은 없었다.
- 흔적 검사: 회사 서버에서 키 형태·값이 붙은 `serviceKey=`·이메일 0건, 개발 PC 에서 이메일·전화·주민번호·사업자번호·깨진 글자(`U+FFFD`)·URL 0건.
- 같은 날 10:54 에 같은 달을 10행으로 한 번 먼저 녹음했다(`totalCount 144`). 진행상태 값을 다 보려고 100행으로 다시 받았고, 10행 녹음은 넣지 않았다.
- 쓰는 곳: `web/server/ingestion/external-adapters.test.ts` 의 "K-water 실응답 녹음 재생". 이 녹음을 고치거나 값을 지어 넣지 않는다. 다시 녹음하면 새 파일로 더하고 이 표에 적는다.
