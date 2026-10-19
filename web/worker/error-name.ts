// ── 로그에 싣는 오류 이름(worker 공용) ──
// message 는 접속 문자열·공고 원문을 담을 수 있어 로그에 싣지 않고 이름만 싣는다(docs/14).
// 이름도 개행·공백·긴 값·접속 문자열이 섞이면 로그 줄을 깨거나 값을 실을 수 있으므로 클래스 이름 모양일 때만 그대로 쓴다.
// 이 규칙은 이 파일 한 곳에만 둔다. 다른 worker 파일은 errorNameOf 를 가져다 쓴다(복사본은 한쪽만 고쳐지는 일이 생긴다).

const SAFE_ERROR_NAME = /^[A-Za-z0-9_]{1,60}$/;

/** Error 가 아니면 "NonError", 이름이 클래스 이름 모양(영문·숫자·밑줄 1~60자)이 아니면 "Error" 다. */
export function errorNameOf(error: unknown): string {
  if (!(error instanceof Error)) return "NonError";
  // RegExp.test 는 문자열이 아닌 값을 문자열로 바꿔 검사하므로(123 → "123") 타입을 먼저 본다.
  const { name } = error;
  return typeof name === "string" && SAFE_ERROR_NAME.test(name) ? name : "Error";
}
