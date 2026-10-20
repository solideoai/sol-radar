// 사전 분석(demo:preanalyze)은 Compose worker 컨테이너가 자기 env 의 Supabase 로 쓴다.
// 그 주소가 이 시험의 로컬 Supabase(supabase status API_URL)가 아니면 사용자 확인 없이 다른 DB(클라우드)에 쓰게 된다.
// 그래서 실행 전에 두 주소가 같은 로컬 Supabase 인지 비교한다(값은 찍지 않는다). Playwright 를 부르지 않는 순수 함수다.
//
// 컨테이너 안에서 호스트의 루프백은 host.docker.internal 이다(infra/.env: http://host.docker.internal:54321).
// 그래서 루프백 이름들은 같은 호스트로 보고, 프로토콜·포트까지 같아야 같다고 본다. 로컬 status 쪽이 루프백이 아니면 늘 다르다.
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "host.docker.internal"]);

const parse = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const hostKey = (url: URL) => (LOOPBACK.has(url.hostname) ? "loopback" : url.hostname);

export function isSameLocalSupabase(workerUrl: string, statusUrl: string): boolean {
  const worker = parse(workerUrl.trim());
  const status = parse(statusUrl.trim());
  if (worker === null || status === null) return false;
  return (
    hostKey(status) === "loopback" &&
    hostKey(worker) === hostKey(status) &&
    worker.protocol === status.protocol &&
    worker.port === status.port
  );
}
