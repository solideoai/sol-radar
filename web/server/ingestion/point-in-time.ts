import "server-only";

// ── 15 §7 시점 일치: 결정 시각 뒤에 수집된 revision 을 쓰면 백테스트가 미래를 엿본다 ──
export function isVisibleAt(revision: { fetchedAt: string }, decisionAt: Date): boolean {
  // 읽을 수 없는 fetchedAt 은 NaN 이라 비교가 거짓이 되어 보이지 않는 쪽으로 떨어진다.
  return Date.parse(revision.fetchedAt) <= decisionAt.getTime();
}

export function revisionAsOf<T extends { revision: number; fetchedAt: string }>(
  revisions: readonly T[],
  decisionAt: Date,
): T | null {
  return revisions
    .filter((revision) => isVisibleAt(revision, decisionAt))
    .reduce<T | null>(
      (latest, revision) =>
        latest === null || revision.revision > latest.revision ? revision : latest,
      null,
    );
}
