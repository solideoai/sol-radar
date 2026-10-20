// ── 로그에 싣는 오류 이름(worker 공용) ──
// 규칙은 web/server/shared/error-name.ts 한 곳에 있다(도메인도 같은 규칙을 쓰므로 shared 층에 둔다).
// worker 파일은 지금처럼 이 경로에서 errorNameOf 를 가져다 쓴다. 여기에 규칙을 다시 적지 않는다.
export { errorNameOf } from "@/server/shared";
