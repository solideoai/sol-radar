// foldAssignmentsIntoAvailability 의 시험. 실행: 루트에서 `node --test scripts/people/availability.test.mjs`
//
// 기대값은 web/server/scoring/scoring.model.ts `availableFte` 의 읽기 방식(반개구간, 창은 max, 배정은 합, 잔여는 0 절단)을
// 손으로 계산한 것이다. 여기서는 C4 함수를 부르지 않는다 — DB 경로와 fixture 경로의 가용 FTE 가 같은지는
// scripts/demo-reset.test.mjs 가 C4 함수로 본다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { assignmentsOf, foldAssignmentsIntoAvailability } from "./availability.mjs";

const window = (startsAt, endsAt, fte = 1) => ({ startsAt, endsAt, fte });
const assignment = (startsAt, endsAt, allocationPercent = 100) => ({
  personId: "SOL-P0001",
  startsAt,
  endsAt,
  allocationPercent,
});
const FULL = window("2026-12-01", "2027-07-01");

describe("foldAssignmentsIntoAvailability", () => {
  it("배정이 창 전체를 덮으면 그 창의 fte 가 0 이 된다(창 경계와 같은 날짜)", () => {
    assert.deepEqual(
      foldAssignmentsIntoAvailability([FULL], [assignment("2026-12-01", "2027-07-01")]),
      [window("2026-12-01", "2027-07-01", 0)],
    );
    assert.deepEqual(
      foldAssignmentsIntoAvailability(
        [window("2026-12-01", "2027-07-01", 0.5)],
        [assignment("2026-12-01", "2027-07-01", 50)],
      ),
      [window("2026-12-01", "2027-07-01", 0)],
    );
  });

  it("배정이 창 일부만 덮으면 앞·뒤 구간은 원래 fte 로 남고 덮인 구간만 줄어든다", () => {
    assert.deepEqual(
      foldAssignmentsIntoAvailability([FULL], [assignment("2027-01-01", "2027-03-01", 50)]),
      [
        window("2026-12-01", "2027-01-01", 1),
        window("2027-01-01", "2027-03-01", 0.5),
        window("2027-03-01", "2027-07-01", 1),
      ],
    );
    // 배정이 창 밖까지 뻗으면 창 안쪽만 바뀌고 창의 경계는 그대로다.
    assert.deepEqual(
      foldAssignmentsIntoAvailability([FULL], [assignment("2026-10-01", "2027-02-01", 100)]),
      [window("2026-12-01", "2027-02-01", 0), window("2027-02-01", "2027-07-01", 1)],
    );
  });

  it("창 경계와 같은 날짜에서 시작하거나 끝나는 배정은 한쪽만 쪼갠다", () => {
    assert.deepEqual(
      foldAssignmentsIntoAvailability([FULL], [assignment("2026-12-01", "2027-02-01")]),
      [window("2026-12-01", "2027-02-01", 0), window("2027-02-01", "2027-07-01", 1)],
    );
    assert.deepEqual(
      foldAssignmentsIntoAvailability([FULL], [assignment("2027-05-01", "2027-07-01")]),
      [window("2026-12-01", "2027-05-01", 1), window("2027-05-01", "2027-07-01", 0)],
    );
  });

  it("같은 기간에 배정이 여럿이면 비율을 합산한다(부동소수 찌꺼기 없음)", () => {
    assert.deepEqual(
      foldAssignmentsIntoAvailability(
        [FULL],
        [assignment("2027-01-01", "2027-04-01", 30), assignment("2027-02-01", "2027-05-01", 50)],
      ),
      [
        window("2026-12-01", "2027-01-01", 1),
        window("2027-01-01", "2027-02-01", 0.7),
        window("2027-02-01", "2027-04-01", 0.2),
        window("2027-04-01", "2027-05-01", 0.5),
        window("2027-05-01", "2027-07-01", 1),
      ],
    );
    // 같은 비율의 배정이 맞닿으면 구간 하나로 돌려놓는다(fte 가 같은 창을 둘로 나누지 않는다).
    assert.deepEqual(
      foldAssignmentsIntoAvailability(
        [FULL],
        [assignment("2027-01-01", "2027-02-01", 50), assignment("2027-02-01", "2027-03-01", 50)],
      ),
      [
        window("2026-12-01", "2027-01-01", 1),
        window("2027-01-01", "2027-03-01", 0.5),
        window("2027-03-01", "2027-07-01", 1),
      ],
    );
  });

  it("비율 합이 fte 를 넘으면 음수가 아니라 0 으로 자른다", () => {
    assert.deepEqual(
      foldAssignmentsIntoAvailability(
        [FULL],
        [assignment("2027-01-01", "2027-03-01", 70), assignment("2027-01-01", "2027-03-01", 50)],
      ),
      [
        window("2026-12-01", "2027-01-01", 1),
        window("2027-01-01", "2027-03-01", 0),
        window("2027-03-01", "2027-07-01", 1),
      ],
    );
    assert.deepEqual(
      foldAssignmentsIntoAvailability(
        [window("2026-12-01", "2027-07-01", 0.5)],
        [assignment("2026-12-01", "2027-07-01", 100)],
      ),
      [window("2026-12-01", "2027-07-01", 0)],
    );
  });

  it("겹치지 않는 배정(앞·뒤·경계에 맞닿음)은 창을 바꾸지 않는다 — 끝은 열린 경계다", () => {
    const untouched = [
      assignment("2026-10-01", "2026-12-01"), // 창 시작에서 끝남
      assignment("2027-07-01", "2027-09-01"), // 창 끝에서 시작
      assignment("2025-01-01", "2025-06-01", 100),
    ];
    assert.deepEqual(foldAssignmentsIntoAvailability([FULL], untouched), [FULL]);
    assert.deepEqual(foldAssignmentsIntoAvailability([FULL], []), [FULL]);
    assert.deepEqual(
      foldAssignmentsIntoAvailability([], [assignment("2026-12-01", "2027-07-01")]),
      [],
    );
  });

  it("창이 여럿이면 각각 접고, 덮는 창이 없는 구간은 만들지 않는다", () => {
    const windows = [
      window("2026-12-01", "2027-02-01", 1),
      window("2027-03-01", "2027-07-01", 0.5),
    ];
    assert.deepEqual(
      foldAssignmentsIntoAvailability(windows, [assignment("2027-01-01", "2027-04-01", 50)]),
      [
        window("2026-12-01", "2027-01-01", 1),
        window("2027-01-01", "2027-02-01", 0.5),
        window("2027-03-01", "2027-04-01", 0),
        window("2027-04-01", "2027-07-01", 0.5),
      ],
    );
  });

  it("입력 배열·객체를 바꾸지 않고, 잘못된 날짜·비율·빈 구간은 RangeError 로 거절한다", () => {
    const windows = [{ ...FULL }];
    const assignments = [assignment("2027-01-01", "2027-03-01", 50)];
    const snapshot = structuredClone({ windows, assignments });
    foldAssignmentsIntoAvailability(windows, assignments);
    assert.deepEqual({ windows, assignments }, snapshot);
    for (const [badWindows, badAssignments] of [
      [[window("bad", "2027-07-01")], []],
      [[window("2027-07-01", "2026-12-01")], []],
      [[window("2026-12-01", "2026-12-01")], []],
      [[window("2026-12-01", "2027-07-01", 1.5)], []],
      [[window("2026-12-01", "2027-07-01", -1)], []],
      [[FULL], [assignment("2027-01-01", "2027-03-01", 150)]],
      [[FULL], [assignment("2027-03-01", "2027-01-01", 50)]],
      [[FULL], [assignment("2027-01-01", "bad", 50)]],
    ])
      assert.throws(() => foldAssignmentsIntoAvailability(badWindows, badAssignments), RangeError);
  });

  it("명부 fixture: 투입 7명은 2026-12~2027-07 이 fte 0 이고 나머지 193명은 그대로다", async () => {
    const { people, assignments } = JSON.parse(
      await readFile(new URL("../../fixtures/people/solideo.people.json", import.meta.url), "utf8"),
    );
    const eligible = people.filter((person) => person.scoringEligible);
    const busy = new Set(assignments.map((row) => row.personId));
    assert.equal(eligible.length, 200);
    assert.equal(busy.size, 7);
    for (const person of eligible) {
      const folded = foldAssignmentsIntoAvailability(
        person.availability,
        assignmentsOf(assignments, person.personId),
      );
      assert.deepEqual(
        folded,
        busy.has(person.personId) ? [window("2026-12-01", "2027-07-01", 0)] : person.availability,
        person.personId,
      );
    }
    assert.deepEqual(
      assignmentsOf(assignments, "SOL-P0012").map((row) => row.personId),
      ["SOL-P0012"],
    );
    assert.deepEqual(assignmentsOf(assignments, "SOL-P0004"), []);
  });
});
