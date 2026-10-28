# KEPCO 전자입찰계약정보 15148223 — 실응답 녹음 (가린 응답)

이 폴더의 파일은 **실제 API 응답**을 가려 저장한 녹음이다. 사람이 만든 합성 값을 섞지 않는다.

| 파일 | 요청 | 받은 때 | 결과 |
|---|---|---|---|
| `electContract.20261027.masked.json` | `electContract`, 공고일 2026-10-27 하루, `returnType=json`, 회사 구분(`companyId`) 없음 | 2026-10-28 10:46 KST(`fetchedAt 2026-10-28T01:46:48.786Z`) | HTTP 200, `text/plain;charset=utf-8`, 최상위 `data` 배열, 항목 71. 결과 코드·`totalCount` 칸 없음 |

- 녹음 스크립트: `scripts/recorded/record-kepco-contract.mjs`(커밋 `f72f4f02`, 회사 서버로 보낸 파일 sha256 `36792733…`). 형식 `sol-external-recorded/v0.1`.
- 파일 sha256 `5d9389300ed7a05be8e387beccd1bca7521e28a07e0c112d71bb660a2a70a599`, 원본 바이트 sha256(`rawSha256`) `4c81ff95c046490e68473ad19aaf65ac21052f0aed5d6c85f8c49ced091a049f`.
- 가림: 키 흔적·명세 밖 칸·담당자 칸은 `***`, 이메일·전화 꼴은 같은 길이 `*`. 명세 밖 칸 20개(`approximateAmount`·`contractReqDepartmentName` 등)는 값을 지웠고, `etc`·`filenlink1~5` 는 이메일·전화 꼴 부분만 가렸다(`maskedFields`).
- 흔적 검사: 회사 서버에서 키 형태·값이 붙은 `apiKey=`·이메일 0건, 개발 PC 에서 이메일·전화·주민번호·사업자번호·깨진 글자(`U+FFFD`)·40자 키 꼴 0건. URL 은 공개 첨부 주소 `http://srm.kepco.net/…` 뿐이다.
- 쓰는 곳: `web/server/ingestion/external-adapters.test.ts` 의 "KEPCO 실응답 녹음 재생". 이 녹음을 고치거나 값을 지어 넣지 않는다. 다시 녹음하면 새 파일로 더하고 이 표에 적는다.
- 증거: `docs/evidence/ingestion/20261028-kepco-contract/first-call.md`.
