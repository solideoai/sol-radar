// 커밋 메시지 규칙 — `타입: 작업 내용`. 커밋마다 .husky/commit-msg 가 검사한다.
//
// 순수 함수만 둔다. 파일을 읽고 종료 코드를 내는 일은 check-commit-msg.mjs 가 한다.

// 타입과 뜻. 이 순서 그대로 안내문에 나온다.
export const TYPE_MEANINGS = {
  feat: "새 기능",
  fix: "버그 수정",
  docs: "문서",
  style: "서식 (동작 변화 없음)",
  refactor: "구조 개선 (동작 변화 없음)",
  perf: "성능",
  test: "테스트",
  build: "빌드·의존성",
  ci: "CI 설정",
  chore: "그 밖의 잡무",
  revert: "되돌리기",
};

export const COMMIT_TYPES = Object.keys(TYPE_MEANINGS);

// 첫 줄이 이보다 길면 "간단하게"가 아니다. 자세한 설명은 본문으로 내린다.
export const MAX_HEADER_LENGTH = 50;

const TYPES = COMMIT_TYPES.join("|");
// 범위는 선택이다. 타입 바로 뒤 괄호 안에 공백 없이 쓴다: feat(web), fix(web/auth), docs(로그인)
const SCOPE = "(\\([^()\\s]+\\))?";
const OPENS_SCOPE = new RegExp(`^(${TYPES})\\s*\\(`);
const VALID_SCOPE = new RegExp(`^(${TYPES})\\([^()\\s]+\\)`);
const SPACE_BEFORE_COLON = new RegExp(`^(${TYPES})${SCOPE}\\s+:`);
const STARTS_WITH_TYPE = new RegExp(`^(${TYPES})${SCOPE}:`);
// 콜론 뒤 정확히 한 칸, 그다음은 공백이 아닌 글자
const WELL_FORMED = new RegExp(`^(${TYPES})${SCOPE}: \\S`);

// git 이 스스로 만드는 메시지(병합·되돌리기·autosquash)는 사람이 쓴 게 아니라서 규칙 밖이다.
const GIT_GENERATED = /^(Merge |Revert "|fixup! |squash! |amend! )/;

// `git commit -v` 가 붙이는 가위 줄. 이 아래는 diff 라서 커밋에 들어가지 않는다.
const SCISSORS = /^# -+ >8 -+$/;

// 훅은 git 이 정리하기 전의 원문을 받는다. git 이 지울 부분(가위 줄 아래·# 주석·앞쪽 빈 줄)을 먼저 걷어낸다.
export const cleanMessage = (raw) => {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const scissorsAt = lines.findIndex((line) => SCISSORS.test(line));
  const kept = (scissorsAt === -1 ? lines : lines.slice(0, scissorsAt)).filter(
    (line) => !line.startsWith("#"),
  );
  const firstContentAt = kept.findIndex((line) => line.trim() !== "");
  return firstContentAt === -1 ? [] : kept.slice(firstContentAt);
};

// 앞에서부터 처음 걸린 하나만 알려 준다. 타입이 틀렸는데 띄어쓰기까지 짚으면 헷갈린다.
const FORMAT_RULES = [
  {
    isBroken: (header) => SPACE_BEFORE_COLON.test(header),
    reason: "콜론(:) 앞에는 띄우지 마세요.",
  },
  {
    isBroken: (header) => OPENS_SCOPE.test(header) && !VALID_SCOPE.test(header),
    reason: "범위는 타입 바로 뒤 괄호 안에 공백 없이 쓰세요. 예: feat(web): 로그인 화면 추가",
  },
  {
    isBroken: (header) => !STARTS_WITH_TYPE.test(header),
    reason: `맨 앞에 타입(필요하면 범위)과 콜론을 쓰세요. 타입: ${COMMIT_TYPES.join(", ")}`,
  },
  {
    isBroken: (header) => !WELL_FORMED.test(header),
    reason: "콜론(:) 뒤에는 정확히 한 칸 띄우고 작업 내용을 쓰세요.",
  },
];

const formatProblem = (header) => FORMAT_RULES.find((rule) => rule.isBroken(header))?.reason;

const lengthProblem = (header) => {
  const length = [...header].length;
  return length > MAX_HEADER_LENGTH
    ? `첫 줄이 ${length}자입니다. ${MAX_HEADER_LENGTH}자 이내로 줄이고, 자세한 설명은 한 줄 비운 뒤 아래에 쓰세요.`
    : undefined;
};

const bodyProblem = (secondLine) =>
  secondLine !== undefined && secondLine.trim() !== ""
    ? "제목 다음 줄은 비워 두세요. 자세한 설명은 한 줄 비운 뒤 그 아래에 씁니다."
    : undefined;

// 규칙에 어긋난 이유 목록. 빈 배열이면 통과다.
export const findProblems = (raw) => {
  const lines = cleanMessage(raw);
  if (lines.length === 0) return ["커밋 메시지가 비어 있습니다."];

  const [header, secondLine] = lines;
  if (GIT_GENERATED.test(header)) return [];

  return [formatProblem(header), lengthProblem(header), bodyProblem(secondLine)].filter(Boolean);
};
