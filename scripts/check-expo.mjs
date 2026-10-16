#!/usr/bin/env node
// 앱 Expo 점검 — mobile 의 `pnpm check:expo` 가 부른다(앱 폴더에서 돈다).
//
// expo-doctor 가 앱 설정(app.json) 스키마와 SDK 권장 버전 등을 본다. 버전은 mobile devDependency 로 고정한다.
// 스키마와 React Native Directory 점검은 서버에서 받아 온다. 네트워크가 필요해서 커밋 게이트(verify:quick)에는
// 넣지 않고 full verify(CI·/verify)에서만 돈다.
//
// 권장 버전은 서버가 아니라 설치된 expo 의 목록에서 읽게 한다(EXPO_OFFLINE). 서버 목록으로 보면 Expo 가 새 패치를
// 낸 날, 코드를 바꾸지 않았는데 검증이 깨진다. 설치된 목록은 락파일이 정하므로 같은 커밋은 늘 같은 결과가 나온다.
// 설치된 패키지가 그 목록과 어긋나는 것(하나만 올리거나 내린 경우)은 그대로 잡는다(실측).
// 새 패치가 나왔는지는 검증이 아니라 갱신할 때 본다: pnpm -C mobile exec expo install --check
//
// 거짓 성공을 막는다. expo-doctor 1.20.4 는 아래 값이 있으면 문제를 놓친 채 통과한다(실측).
// - EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK: 버전 점검을 건너뛴다.
// - EXPO_DOCTOR_WARN_ON_NETWORK_ERRORS: 연결 오류를 실패로 세지 않는다.
// - EXPO_STAGING·EXPO_LOCAL: 운영이 아닌 API 를 본다.
// 이 값들은 mobile/.env 로도 들어오므로 .env 읽기도 끈다(EXPO_NO_DOTENV). CI 에는 .env 가 없어 결과가 같다.
// 서버에 닿지 못하면 스키마·Directory 점검이 fetch failed 로 실패한다(실측). 그래서 먼저 Expo API 에 닿는지 보고,
// 닿지 않으면 원인을 짚어 바로 실패한다. expo-doctor 를 올리면 네트워크를 막고 돌려 실패하는지 다시 본다.
//
// 인자: --api <주소> 연결 확인에 쓸 주소(시험용). 기본은 Expo API.
import { spawnCommandSync } from "./command.mjs";

const BYPASS = [
  "EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK",
  "EXPO_DOCTOR_WARN_ON_NETWORK_ERRORS",
  "EXPO_STAGING",
  "EXPO_LOCAL",
];
const api = process.argv.includes("--api")
  ? process.argv[process.argv.indexOf("--api") + 1]
  : "https://api.expo.dev";

const fail = (lines) => {
  console.error(
    ["[차단] Expo 점검(expo-doctor) 실패", ...lines.map((line) => `   ${line}`)].join("\n"),
  );
  process.exit(1);
};

const reachable = await fetch(api, { signal: AbortSignal.timeout(10_000) })
  .then((response) => response.status < 500)
  .catch(() => false);
if (!reachable)
  fail([
    `Expo API(${api})에 닿지 않습니다. 이 점검은 네트워크가 필요합니다.`,
    "연결을 확인하고 다시 돌리세요. 네트워크 없이 통과시키지 않습니다.",
  ]);

const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !BYPASS.includes(key))),
  EXPO_NO_DOTENV: "1",
  EXPO_OFFLINE: "1",
};
const doctor = spawnCommandSync("expo-doctor", [], { stdio: "inherit", env });

if (doctor.error)
  fail([
    `expo-doctor 를 실행할 수 없습니다: ${doctor.error.message}`,
    "pnpm -C mobile install 로 의존성을 먼저 설치하세요.",
  ]);
if (doctor.status !== 0)
  fail([
    "위 ✖ 항목이 원인입니다. 자주 나오는 경우:",
    "- 앱 설정 스키마: 지적된 속성을 mobile/app.json 에서 고치거나 지운다.",
    "- SDK 권장 버전 불일치: 설치된 패키지가 설치된 expo 의 권장 목록과 다르다.",
    "  pnpm -C mobile exec expo install --fix 로 맞추고 package.json·pnpm-lock.yaml 을 함께 커밋한다.",
    "- fetch failed 같은 연결 오류: Expo API 연결이 필요하다. 네트워크를 확인하고 다시 돌린다.",
  ]);
