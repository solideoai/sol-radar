// 앱 테스트는 순수 로직만 본다 (계산·변환·검증).
// 화면 렌더링 테스트는 넣지 않는다 — 앱 화면은 시뮬레이터·실기기에서 직접 점검한다.
const path = require("node:path");

// Expo 의 Babel 변환은 @babel/runtime helper 를 코드에 끼워 넣지만, 이 프로젝트의 직접 의존성이 아니다.
// pnpm 실행기가 NODE_PATH 로 숨은 의존성을 보여 줄 때만 우연히 통과하지 않게, expo 가 선언한
// @babel/runtime 을 찾아 그 자리로 연결한다(버전·.pnpm 경로를 적지 않는다).
const babelRuntimeRoot = path.dirname(
  require.resolve("@babel/runtime/package.json", {
    paths: [require.resolve("expo/package.json")],
  }),
);

module.exports = {
  preset: "jest-expo",
  testMatch: ["**/?(*.)+(test|spec).ts?(x)"],
  testPathIgnorePatterns: ["/node_modules/", "/.expo/"],
  moduleNameMapper: { "^@babel/runtime/(.*)$": `${babelRuntimeRoot}/$1` },
};
