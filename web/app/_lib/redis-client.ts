import "server-only";
import { Redis } from "ioredis";

// 프로세스에 하나인 Redis 클라이언트(큐 producer·속도 제한이 함께 쓴다). 주소가 바뀌면 새로 만든다.
// 오프라인 큐를 꺼서 Redis 가 죽었을 때 명령이 쌓이지 않고 바로 실패한다.
let shared: { url: string; client: Redis } | null = null;

export function sharedRedis(url: string): Redis {
  if (shared?.url === url) return shared.client;
  shared?.client.disconnect();
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  // 연결 실패는 명령 쪽 예외로 알린다. 'error' 이벤트를 듣지 않으면 처리되지 않은 오류가 된다.
  client.on("error", () => {});
  shared = { url, client };
  return client;
}

// 명령 전에 연결이 끝났는지 본다. 오프라인 큐가 없어서 연결 중에 보낸 명령은 바로 실패한다.
const isReady = (client: Redis): boolean => client.status === "ready";

export async function readyRedis(url: string, timeoutMs: number): Promise<Redis> {
  const client = sharedRedis(url);
  if (isReady(client)) return client;
  if (client.status === "wait" || client.status === "end") await client.connect();
  if (isReady(client)) return client;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error("Redis 연결 시간 초과")), timeoutMs);
    const finish = (error?: Error) => {
      clearTimeout(timer);
      client.off("ready", onReady);
      client.off("close", onClose);
      if (error) reject(error);
      else resolve();
    };
    const onReady = () => finish();
    const onClose = () => finish(new Error("Redis 연결이 닫혔습니다"));
    client.once("ready", onReady);
    client.once("close", onClose);
  });
  return client;
}
