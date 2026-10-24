import "server-only";
import { describe, expect, it } from "vitest";
import { buildPeopleDirectory, resolveMemberPortrait, type MemberRow } from "./people.model";
import { rows } from "./people.test-data";

const base: MemberRow = {
  id: "00000000-0000-4000-8000-000000000001",
  person_code: "SOL-P0001",
  name: "김민준",
  email: null,
  department_id: "00000000-0000-4000-8000-000000000101",
  job_title_id: "00000000-0000-4000-8000-000000000201",
  portrait_path: "/demo/people/SOL-P0001.png",
  is_demo: true,
  user_id: null,
  photo_path: null,
  linked_avatar_url: null,
};
const uploaded =
  "members/00000000-0000-4000-8000-000000000001/0a1b2c3d-0000-4000-8000-00000000abcd.jpg";
const signed = "https://x.supabase.co/storage/v1/object/sign/profile-photos/m.jpg?token=t";

describe("resolveMemberPortrait", () => {
  it.each([
    [
      "올린 사진의 서명 주소가 먼저다",
      { photo_path: uploaded },
      new Map([[uploaded, signed]]),
      signed,
    ],
    ["올린 사진이 없으면 데모 정장 사진", {}, new Map(), "/demo/people/SOL-P0001.png"],
    [
      "서명에 실패하면 데모 정장 사진으로 돌아간다",
      { photo_path: uploaded },
      new Map(),
      "/demo/people/SOL-P0001.png",
    ],
    [
      "비데모 직원은 연결 계정의 제공자 사진",
      {
        is_demo: false,
        person_code: "SOL-N0001",
        portrait_path: null,
        linked_avatar_url: "https://lh3.googleusercontent.com/a",
      },
      new Map(),
      "https://lh3.googleusercontent.com/a",
    ],
    [
      "https 가 아닌 제공자 사진은 쓰지 않는다",
      {
        is_demo: false,
        person_code: "SOL-N0001",
        portrait_path: null,
        linked_avatar_url: "http://lh3.googleusercontent.com/a",
      },
      new Map(),
      null,
    ],
    [
      "아무것도 없으면 null(머리글자)",
      { is_demo: false, person_code: "SOL-N0001", portrait_path: null },
      new Map(),
      null,
    ],
  ] as const)("%s", (_, patch, urls, expected) => {
    expect(resolveMemberPortrait({ ...base, ...patch }, urls)).toBe(expected);
  });
});

describe("buildPeopleDirectory", () => {
  it("비데모 신규 입사자 행도 명부와 인원 수에 들어간다", () => {
    const newHire: MemberRow = {
      ...base,
      id: "00000000-0000-4000-8000-000000009001",
      person_code: "SOL-N0001",
      name: "Lee Gwanghui",
      portrait_path: null,
      is_demo: false,
      department_id: rows.members[0].department_id,
      job_title_id: rows.members[0].job_title_id,
    };
    const directory = buildPeopleDirectory({
      ...rows,
      members: [...rows.members, newHire],
      photoUrls: new Map(),
      canManagePhotos: false,
    });
    const found = directory.members.find((member) => member.personCode === "SOL-N0001");
    expect(found).toMatchObject({ isDemo: false, name: "Lee Gwanghui", portraitUrl: null });
    expect(directory.summary.totalCount).toBe(rows.members.length + 1);
    expect(directory.canManagePhotos).toBe(false);
  });
});
