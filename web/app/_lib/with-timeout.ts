import "server-only";

// 작업이 제한 시간 안에 끝나지 않으면 거부한다. 먼저 끝나면 타이머를 지운다.
export function withTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label}이(가) ${timeoutMs}ms 안에 끝나지 않았습니다`)),
      timeoutMs,
    );
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
