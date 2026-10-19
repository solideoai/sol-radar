// people/availability.mjs — 명부 fixture 의 기존 사업 투입(assignments)을 가용성 창(availability)에 접는 순수 함수.
//
// 왜 접는가: `assignments` 표는 `bid_id not null` 이라 공고 없는 기존 투입을 넣을 수 없고(04 §6 seed 는 데모 배정 2건만),
// 점수 계산(web/server/scoring/scoring.model.ts `availableFte`)은 시점마다 "가용 = 그 시점을 덮는 창의 fte 중 최댓값,
// 배정 = 그 시점 배정 비율의 합, 잔여 = max(0, 가용 − 배정)" 으로 읽는다. 겹치는 창은 max 로 읽히므로 fte 0 창을
// 덧붙여도 아무것도 줄지 않는다. 그래서 기존 창을 배정 기간에서 쪼개 그 구간의 fte 에서 비율을 뺀다.
// 그러면 DB 에서 읽은 팀(접힌 availability + 데모 배정 2건)과 fixture 팀(원본 + 배정 7건 + 데모 2건)의 가용 FTE 가 같다.
//
// 구간은 `availableFte` 와 같이 반개구간 [startsAt, endsAt) 이고 경계는 Date.parse 로 읽는다. 모양은 fixture·JSONB 그대로
// (`startsAt`·`endsAt` 날짜 문자열, `fte` 0~1, `allocationPercent` 0~100)이며 들어온 배열·객체를 바꾸지 않는다.

const instant = (value) => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError(`Invalid capacity date: ${value}`);
  return parsed;
};

const bounded = (value, maximum, label) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum)
    throw new RangeError(`Invalid ${label}: ${value}`);
  return value;
};

const interval = ({ startsAt, endsAt }) => {
  const start = instant(startsAt);
  const end = instant(endsAt);
  if (start >= end) throw new RangeError("Capacity interval must be nonempty");
  return { start, end };
};

// 부동소수 찌꺼기(1 − 0.3 = 0.7000000000000001)를 JSONB 에 남기지 않는다. 비율은 백분율 정수라 1e-4 면 충분하다.
const roundFte = (value) => Math.round(value * 1e4) / 1e4;

// 같은 fte 가 이어지는 구간은 하나로 돌려놓는다. 겹치지 않는 배정은 창을 그대로 남긴다.
const mergeAdjacent = (segments) =>
  segments.reduce((merged, segment) => {
    const last = merged.at(-1);
    if (last && last.fte === segment.fte && last.endsAt === segment.startsAt)
      return [...merged.slice(0, -1), { ...last, endsAt: segment.endsAt }];
    return [...merged, segment];
  }, []);

/**
 * 한 사람의 availability 창에 그 사람의 배정을 접는다.
 * @param {{ startsAt: string, endsAt: string, fte: number }[]} availability
 * @param {{ startsAt: string, endsAt: string, allocationPercent: number }[]} assignments 이 사람의 배정만
 * @returns {{ startsAt: string, endsAt: string, fte: number }[]} 같은 모양. 배정이 창 일부만 덮으면 앞·뒤는 원래 fte 로 남고
 *   덮인 구간만 max(0, fte − 비율 합) 이 된다.
 */
export const foldAssignmentsIntoAvailability = (availability, assignments) => {
  const allocations = assignments.map((assignment) => ({
    ...interval(assignment),
    amount: bounded(assignment.allocationPercent, 100, "allocationPercent") / 100,
  }));
  return availability.flatMap((window) => {
    const { start, end } = interval(window);
    const fte = bounded(window.fte, 1, "fte");
    // 경계 시각 → 원래 문자열. 창 안쪽에 떨어지는 배정 경계에서만 쪼갠다(경계가 같으면 쪼갤 것이 없다).
    const cuts = new Map([
      [start, window.startsAt],
      [end, window.endsAt],
    ]);
    for (const assignment of assignments)
      for (const text of [assignment.startsAt, assignment.endsAt]) {
        const at = instant(text);
        if (start < at && at < end && !cuts.has(at)) cuts.set(at, text);
      }
    const boundaries = [...cuts].toSorted(([left], [right]) => left - right);
    const segments = boundaries.slice(0, -1).map(([at, startsAt], index) => {
      const allocated = allocations
        .filter((allocation) => allocation.start <= at && at < allocation.end)
        .reduce((sum, allocation) => sum + allocation.amount, 0);
      return {
        startsAt,
        endsAt: boundaries[index + 1][1],
        fte: roundFte(Math.max(0, fte - allocated)),
      };
    });
    return mergeAdjacent(segments);
  });
};

/** 명부 전체의 배정 목록에서 한 사람 것만 고른다. */
export const assignmentsOf = (assignments, personId) =>
  assignments.filter((assignment) => assignment.personId === personId);
