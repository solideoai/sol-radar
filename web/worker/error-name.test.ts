import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { errorNameOf as sharedErrorNameOf } from "@/server/shared";
import { errorNameOf } from "@/worker/error-name";

// 로그에 싣는 오류 이름(C5-B 보안 후속 낮음 h 의 공용화).
// error.name 이 /^[A-Za-z0-9_]{1,60}$/ 에 맞을 때만 그대로 싣고, 아니면 "Error", Error 가 아닌 값이면 "NonError" 다.
// 이름에 개행·공백·긴 값·접속 문자열이 들어와 로그 줄을 깨거나 값을 싣지 않게 한다.
// analysis-job·analysis-reconcile·analysis-runtime(queue 오류)·demo-preanalyze(실패 줄)가 이 함수 하나를 함께 쓴다.

const LEAK = "LEAK-redis://:pw-secret@10.0.0.5";

function namedError(name: string): Error {
  const error = new Error(`${LEAK} named`);
  error.name = name;
  return error;
}

class AnalysisStoreError extends Error {
  constructor() {
    super(`${LEAK} store`);
    this.name = "AnalysisStoreError";
  }
}

/** [설명, 기대 이름, 던진 값] */
const NAME_CASES: [string, string, unknown][] = [
  ["new Error()", "Error", new Error(LEAK)],
  ["TypeError", "TypeError", new TypeError(LEAK)],
  ["이름을 정한 하위 클래스", "AnalysisStoreError", new AnalysisStoreError()],
  ["평범한 이름", "ReplyError", namedError("ReplyError")],
  ["밑줄·숫자가 든 이름", "Redis_Error_42", namedError("Redis_Error_42")],
  ["1자 이름", "E", namedError("E")],
  ["60자 이름", "A".repeat(60), namedError("A".repeat(60))],
  ["DOMException(TimeoutError)", "TimeoutError", new DOMException(LEAK, "TimeoutError")],
  ["61자 이름", "Error", namedError("A".repeat(61))],
  ["개행이 든 이름", "Error", namedError('Reply\n{"event":"forged"}')],
  ["끝에 개행이 붙은 이름", "Error", namedError("ReplyError\n")],
  ["공백이 든 이름", "Error", namedError("Reply Error")],
  ["빈 이름", "Error", namedError("")],
  ["값(접속 문자열)이 든 이름", "Error", namedError("redis://:pw-secret@10.0.0.5")],
  ["점·하이픈이 든 이름", "Error", namedError("bullmq.Queue-error")],
  ["한글 이름", "Error", namedError("레디스오류")],
  ["Error 가 아닌 글자", "NonError", `${LEAK} thrown string`],
  ["Error 가 아닌 객체(name 이 있다)", "NonError", { name: "ReplyError", message: LEAK }],
  ["null", "NonError", null],
  ["undefined", "NonError", undefined],
  ["숫자", "NonError", 42],
];

describe("errorNameOf · 로그에 싣는 오류 이름", () => {
  it.each(NAME_CASES)("%s 이면 %s 다", (_label, expected, thrown) => {
    expect(errorNameOf(thrown)).toBe(expected);
  });

  it.each(NAME_CASES)("%s 일 때 결과에 값·개행이 없다", (_label, _expected, thrown) => {
    const name = errorNameOf(thrown);
    expect(name).not.toContain("\n");
    expect(name).not.toContain("LEAK");
    expect(name).not.toContain("pw-secret");
  });

  it("name 이 문자열이 아니면(숫자 123) 'Error' 다. 결과는 늘 문자열이다", () => {
    const error = new Error(LEAK);
    Object.defineProperty(error, "name", { value: 123 });
    expect(errorNameOf(error)).toBe("Error");
  });
});

// ── 규칙은 한 곳에만 있다 ──
// 같은 규칙의 복사본(analysis-job·analysis-reconcile 의 errorNameOf)을 지우고 이 모듈 하나를 함께 쓴다(C5-B 설계 덧붙임).
// 복사본이 남거나 새로 생기면 한쪽만 고쳐지는 일이 생기므로 소스에서 본다.

const WORKER_DIR = new URL("./", import.meta.url);
const RULE_SOURCE = "[A-Za-z0-9_]{1,60}";
const SHARED_USERS = [
  "analysis-job.ts",
  "analysis-reconcile.ts",
  "analysis-runtime.ts",
  "demo-preanalyze.ts",
] as const;

const readWorkerFile = (name: string): string => readFileSync(new URL(name, WORKER_DIR), "utf8");

/** web/worker 의 제품 코드 파일(시험·시험 도우미 제외). */
const productFiles = (): string[] =>
  readdirSync(WORKER_DIR).filter(
    (name) =>
      name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".test-support.ts"),
  );

// 규칙의 자리는 web/server/shared/error-name.ts 다. 도메인(알림 outbox 처리 등)은 worker 를 부를 수 없어(web/lodestar.config.ts)
// 도메인과 worker 가 함께 부를 수 있는 shared 층에 두고, web/worker/error-name.ts 는 그것을 다시 내보낸다.
const WEB_DIR = new URL("../", import.meta.url);
const RULE_HOME = "server/shared/error-name.ts";

/** web/worker·web/server 의 제품 코드 파일(시험·시험 도우미 제외). web 기준 상대 경로. */
const webProductFiles = (): string[] =>
  ["worker", "server"].flatMap((root) =>
    readdirSync(new URL(`${root}/`, WEB_DIR), { recursive: true, encoding: "utf8" })
      .filter(
        (name) =>
          name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".test-support.ts"),
      )
      .map((name) => `${root}/${name}`),
  );

describe("errorNameOf · 공용화", () => {
  it("이름 규칙(/^[A-Za-z0-9_]{1,60}$/)의 복사본이 error-name.ts 밖의 web/worker 제품 코드에 없다", () => {
    const copies = productFiles().filter(
      (name) => name !== "error-name.ts" && readWorkerFile(name).includes(RULE_SOURCE),
    );
    expect(copies).toEqual([]);
  });

  it(`이름 규칙은 web/worker·web/server 제품 코드 가운데 ${RULE_HOME} 한 곳에만 있다`, () => {
    const holders = webProductFiles().filter((name) =>
      readFileSync(new URL(name, WEB_DIR), "utf8").includes(RULE_SOURCE),
    );
    expect(holders).toEqual([RULE_HOME]);
  });

  it("@/worker/error-name 의 errorNameOf 는 @/server/shared 의 그 함수다(다시 내보낸다)", () => {
    expect(errorNameOf).toBe(sharedErrorNameOf);
  });

  it.each(SHARED_USERS)("%s 는 errorNameOf 를 @/worker/error-name 에서 가져다 쓴다", (name) => {
    expect(readWorkerFile(name)).toMatch(
      /import\s*\{[^}]*\berrorNameOf\b[^}]*\}\s*from\s*"(@\/worker|\.)\/error-name"/,
    );
  });
});
