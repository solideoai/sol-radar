import { expect, test } from "@playwright/test";
import { isSameLocalSupabase } from "./support/supabase-target";

// 보안 검토 L7: globalSetup 은 worker 컨테이너의 Supabase 주소가 이 시험의 로컬 Supabase 일 때만 demo:preanalyze 를 돌린다.
// 비교 함수를 음성 사례로 고정한다(브라우저·DB 를 쓰지 않는다).
const STATUS = "http://127.0.0.1:54321";

test("L7 worker 주소가 로컬 Supabase 와 같을 때만 같다고 본다", () => {
  // 컨테이너 안의 호스트 루프백 이름과 끝 슬래시는 같은 주소다.
  expect(isSameLocalSupabase("http://host.docker.internal:54321", STATUS)).toBe(true);
  expect(isSameLocalSupabase("http://127.0.0.1:54321/", STATUS)).toBe(true);
  expect(isSameLocalSupabase("http://localhost:54321", STATUS)).toBe(true);

  // 음성: 클라우드·다른 포트·다른 프로토콜·다른 호스트·빈 값·주소가 아닌 값.
  for (const worker of [
    "https://abcdefghijkl.supabase.co",
    "http://host.docker.internal:54322",
    "https://127.0.0.1:54321",
    "http://10.0.0.5:54321",
    "",
    "not a url",
  ])
    expect(isSameLocalSupabase(worker, STATUS), worker || "(빈 값)").toBe(false);

  // 로컬 status 쪽이 루프백이 아니면 둘이 같아도 로컬이 아니다.
  expect(
    isSameLocalSupabase("https://abcdefghijkl.supabase.co", "https://abcdefghijkl.supabase.co"),
  ).toBe(false);
});
