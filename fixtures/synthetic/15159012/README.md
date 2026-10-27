# LH 입찰공고 15159012 — 합성 응답 (실응답 아님)

이 폴더의 파일은 **사람이 만든 가짜 응답**이다. 실제 API 를 부르지 않았고 실제 공고도 아니다.

- 근거: data.go.kr 공개 명세(Swagger) `https://www.data.go.kr/data/15159012/openapi.do`, 2026-10-27 열람.
  필드 이름·결과 코드(00 정상, 03 데이터없음, 20 접근거부, 22 한도초과, 30 미등록 키)만 명세에서 가져왔다.
- 명세가 정하지 않아 **지어낸 값**: 공고번호 모양, 날짜 자릿수(8·12자리), 금액 단위(원), `bidKind`·`bidProgrsStatus` 값, 지역본부 코드.
  실응답을 받으면 이 값들부터 대조한다.
- 실제 녹음 응답은 `fixtures/recorded/15159012/` 에 둔다(2026-10-27 현재 없음). 녹음은 `infra/sources/registry.yaml` 의
  `sampleResponses` 에 등록하고, 이 폴더 파일은 등록하지 않는다.
- 쓰는 곳: `web/server/ingestion/lh-bid-notice.test.ts`, `scripts/recorded/record-lh-bid-notice.test.mjs` 의 시험만. 제품 코드와 worker 는 읽지 않는다.
- 파일 이름 끝의 `.synthetic.xml` 을 지우거나 이 폴더 밖으로 옮기지 않는다.
