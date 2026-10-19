// .husky/commit-msg 가 부른다. 인자: 커밋 메시지 파일 경로. 규칙은 commit-message.mjs 에 있다.
import { readFileSync } from "node:fs";
import { MAX_HEADER_LENGTH, TYPE_MEANINGS, cleanMessage, findProblems } from "./commit-message.mjs";

const raw = readFileSync(process.argv[2], "utf8");
const problems = findProblems(raw);

if (problems.length > 0) {
  const [header = ""] = cleanMessage(raw);
  const typeGuide = Object.entries(TYPE_MEANINGS).map(
    ([type, meaning]) => `     ${type.padEnd(9)}${meaning}`,
  );

  console.error(
    [
      "[차단] 커밋 메시지가 규칙에 맞지 않습니다:",
      ...problems.map((problem) => `   - ${problem}`),
      `   지금 첫 줄: "${header}"`,
      "",
      `   형식: <타입>: <작업 내용>  또는  <타입>(<범위>): <작업 내용>   (콜론 뒤 정확히 한 칸, 첫 줄 ${MAX_HEADER_LENGTH}자 이내)`,
      "   예시: feat: 로그인 화면 추가 · fix(web): 마감일 계산 오류 수정 · chore: 의존성 정리",
      "   타입:",
      ...typeGuide,
    ].join("\n"),
  );
  process.exit(1);
}
