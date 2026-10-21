import "server-only";

/** 인증·본문·재시도를 하나의 상한으로 묶고, 끝난 작업의 후속 전송도 중단한다. */
export async function withRedisApiDeadline<T>(
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
  parent?: AbortSignal,
): Promise<T> {
  parent?.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};
  const expired = new Promise<never>((_, reject) => {
    stop = () => {
      controller.abort();
      reject(new Error("REDIS_API_TIMEOUT"));
    };
    timer = setTimeout(stop, ms);
    parent?.addEventListener("abort", stop, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return work(controller.signal);
      }),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", stop);
    controller.abort();
  }
}
