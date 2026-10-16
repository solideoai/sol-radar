// 디자인 토큰 생성기(scripts/tokens-gen.mjs) 테스트. 실행: 루트에서 `pnpm test`
//
// 임시 폴더에 생성기와 정본(design/tokens.json)을 복사해 돌린다. "어느 폴더에 무엇을 만들고
// 무엇을 검사하는가"와, 생성물이 꼭 지켜야 하는 모양(조용히 빠지면 안 되는 줄)을 본다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const WEB_OUTPUT = "web/app/globals.css";
const APP_OUTPUT = "mobile/theme/tokens.ts";

// folders: package.json 을 둘 앱 폴더 목록 (web·mobile 중 일부)
const createProject = (t, folders) => {
  const project = mkdtempSync(join(tmpdir(), "tokens-gen-test-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));

  ["scripts/tokens-gen.mjs", "design/tokens.json"].forEach((path) => {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    copyFileSync(join(root, path), join(project, path));
  });
  folders.forEach((folder) => {
    mkdirSync(join(project, folder));
    writeFileSync(join(project, folder, "package.json"), "{}\n");
  });
  return project;
};

const runTokens = (project, args = []) => {
  const result = spawnSync(process.execPath, ["scripts/tokens-gen.mjs", ...args], {
    cwd: project,
    encoding: "utf8",
  });
  return { code: result.status, output: `${result.stdout}${result.stderr}` };
};

const exists = (project, path) => existsSync(join(project, path));
const read = (project, path) => readFileSync(join(project, path), "utf8");

// 복사해 둔 정본(design/tokens.json)을 고친다. edit 는 토큰 객체를 받아 새 토큰 객체를 돌려준다.
const editTokens = (project, edit) => {
  const path = join(project, "design/tokens.json");
  writeFileSync(path, `${JSON.stringify(edit(JSON.parse(readFileSync(path, "utf8"))), null, 2)}\n`);
};

const withoutKey = (object, key) =>
  Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
const withNativeFont = (tokens, name, entry) => ({
  ...tokens,
  nativeFonts: { ...tokens.nativeFonts, [name]: entry },
});

describe("있는 폴더의 생성물만 만든다", () => {
  it("web·mobile 이 다 있으면 생성물 둘을 만들고 검사도 통과한다", (t) => {
    const project = createProject(t, ["web", "mobile"]);

    runTokens(project);

    assert.ok(exists(project, WEB_OUTPUT));
    assert.ok(exists(project, APP_OUTPUT));
    assert.equal(runTokens(project, ["--check"]).code, 0);
  });

  it("web 만 있으면 앱 생성물을 만들지 않고 검사도 통과한다", (t) => {
    const project = createProject(t, ["web"]);

    runTokens(project);

    assert.ok(exists(project, WEB_OUTPUT));
    assert.ok(!exists(project, "mobile"));
    assert.equal(runTokens(project, ["--check"]).code, 0);
  });

  it("mobile 만 있으면 웹 생성물을 만들지 않고 검사도 통과한다", (t) => {
    const project = createProject(t, ["mobile"]);

    runTokens(project);

    assert.ok(exists(project, APP_OUTPUT));
    assert.ok(!exists(project, "web"));
    assert.equal(runTokens(project, ["--check"]).code, 0);
  });
});

describe("생성물과 정본이 어긋나면 막는다", () => {
  it("생성물을 손으로 고치면 --check 가 그 파일을 짚어 실패한다", (t) => {
    const project = createProject(t, ["web", "mobile"]);
    runTokens(project);
    appendFileSync(join(project, WEB_OUTPUT), "/* 손으로 고침 */\n");

    const { code, output } = runTokens(project, ["--check"]);

    assert.notEqual(code, 0);
    assert.match(output, /web\/app\/globals\.css/);
  });

  it("있는 폴더의 생성물이 없으면 --check 가 실패한다", (t) => {
    const project = createProject(t, ["web", "mobile"]);

    const { code } = runTokens(project, ["--check"]);

    assert.notEqual(code, 0);
  });
});

describe("생성물의 모양", () => {
  const colorNames = Object.keys(
    JSON.parse(readFileSync(join(root, "design/tokens.json"), "utf8")).colors,
  );
  const generate = (t) => {
    const project = createProject(t, ["web", "mobile"]);
    runTokens(project);
    return {
      css: readFileSync(join(project, WEB_OUTPUT), "utf8"),
      ts: readFileSync(join(project, APP_OUTPUT), "utf8"),
    };
  };

  it("웹 CSS 는 색마다 원본 변수와 Tailwind 연결을 둘 다 만든다", (t) => {
    const { css } = generate(t);

    colorNames.forEach((name) => {
      assert.match(css, new RegExp(`^  --${name}: `, "m"), `원본 변수 --${name} 이 없다`);
      assert.ok(css.includes(`--color-${name}: var(--${name});`), `--color-${name} 연결이 없다`);
    });
  });

  it("웹 CSS 는 Tailwind 기본 팔레트를 지운다", (t) => {
    const { css } = generate(t);

    assert.ok(css.includes("--color-*: initial;"));
  });

  it("앱 theme 의 키는 하이픈 없는 camelCase 다", (t) => {
    const { ts } = generate(t);

    assert.match(ts, /^  mutedForeground: "/m);
    assert.doesNotMatch(ts, /^  [a-z0-9]+-[a-z0-9-]+:/m);
  });
});

// React Native 의 fontFamily 는 글꼴 이름 하나만 받는다. CSS 처럼 쉼표 목록을 넘기면 오류 없이
// 기본 글꼴로 나오고, expo export 도 못 잡는다. 그래서 생성물의 모양으로 지킨다.
describe("앱 글꼴은 nativeFonts 에서 플랫폼마다 이름 하나씩 온다", () => {
  const tokens = JSON.parse(readFileSync(join(root, "design/tokens.json"), "utf8"));
  const fontNames = Object.keys(tokens.fonts);
  const fontsBlock = (ts) => ts.match(/^export const fonts = \{\n([\s\S]*?)\n\} as const;$/m)?.[1];

  it("앱 theme 의 글꼴은 Platform.select 로 고르고, 값에 쉼표 목록이 없다", (t) => {
    const project = createProject(t, ["web", "mobile"]);
    runTokens(project);
    const ts = read(project, APP_OUTPUT);
    const block = fontsBlock(ts);

    assert.match(ts, /^import \{ Platform \} from "react-native";$/m);
    assert.ok(block, "앱 theme 에 fonts 블록이 없다");
    fontNames.forEach((name) => {
      // default 가 있어야 Platform.select 의 반환 타입이 string 이 된다 (없으면 string | undefined).
      assert.match(
        block,
        new RegExp(
          `^  ${name}: Platform\\.select\\(\\{ ios: "[^"]+", android: "[^"]+", default: "[^"]+" \\}\\),$`,
          "m",
        ),
        `fonts.${name} 이 플랫폼마다 이름 하나를 고르지 않는다`,
      );
    });
    const values = [...block.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(([, value]) => value);
    assert.equal(values.length, fontNames.length * 3);
    values.forEach((value) =>
      assert.doesNotMatch(value, /,/, `앱 글꼴 값에 쉼표 목록이 있다: ${value}`),
    );
  });

  it("앱 theme 의 글꼴 값은 tokens.json 의 nativeFonts 에서 온다", (t) => {
    const project = createProject(t, ["mobile"]);
    editTokens(project, (current) =>
      withNativeFont(current, "sans", { ios: "Helvetica", android: "Roboto" }),
    );

    assert.equal(runTokens(project).code, 0);

    assert.match(
      fontsBlock(read(project, APP_OUTPUT)),
      /^  sans: Platform\.select\(\{ ios: "Helvetica", android: "Roboto", default: "Roboto" \}\),$/m,
    );
  });

  it("웹 CSS 의 글꼴은 fonts 의 CSS 목록 그대로이고, nativeFonts 를 바꿔도 달라지지 않는다", (t) => {
    const project = createProject(t, ["web", "mobile"]);
    runTokens(project);
    const before = read(project, WEB_OUTPUT);
    editTokens(project, (current) =>
      withNativeFont(current, "sans", { ios: "Helvetica", android: "Roboto" }),
    );

    assert.equal(runTokens(project).code, 0);

    const after = read(project, WEB_OUTPUT);
    assert.equal(after, before);
    fontNames.forEach((name) =>
      assert.ok(
        after.includes(`  --font-${name}: ${tokens.fonts[name]};`),
        `--font-${name} 이 CSS 목록이 아니다`,
      ),
    );
  });
});

describe("앱 글꼴(nativeFonts)이 어긋나면 막는다", () => {
  // [무엇이 어긋났나, 정본을 어떻게 망가뜨리나, 메시지가 짚어야 할 자리]
  const brokenCases = [
    ["nativeFonts 가 통째로 없다", (tokens) => withoutKey(tokens, "nativeFonts"), /nativeFonts/],
    [
      "fonts 의 키 하나가 nativeFonts 에 없다",
      (tokens) => ({ ...tokens, nativeFonts: withoutKey(tokens.nativeFonts, "mono") }),
      /nativeFonts\.mono/,
    ],
    [
      "플랫폼 하나가 빠졌다",
      (tokens) => withNativeFont(tokens, "sans", { ios: "System" }),
      /nativeFonts\.sans\.android/,
    ],
    [
      "값이 CSS 처럼 쉼표 목록이다",
      (tokens) =>
        withNativeFont(tokens, "sans", { ios: "System, Helvetica", android: "sans-serif" }),
      /nativeFonts\.sans\.ios/,
    ],
    [
      "값이 빈 문자열이다",
      (tokens) => withNativeFont(tokens, "mono", { ios: "Menlo", android: " " }),
      /nativeFonts\.mono\.android/,
    ],
    [
      "fonts 에 없는 키가 있다",
      (tokens) => withNativeFont(tokens, "serif", { ios: "Georgia", android: "serif" }),
      /nativeFonts\.serif/,
    ],
  ];

  brokenCases.forEach(([title, breakTokens, pointer]) => {
    it(`${title} → 생성도 --check 도 그 자리를 짚어 실패하고, 앱 생성물을 덮지 않는다`, (t) => {
      const project = createProject(t, ["web", "mobile"]);
      runTokens(project);
      const before = read(project, APP_OUTPUT);
      editTokens(project, breakTokens);

      const generated = runTokens(project);
      const checked = runTokens(project, ["--check"]);

      assert.notEqual(generated.code, 0);
      assert.match(generated.output, pointer);
      assert.equal(read(project, APP_OUTPUT), before);
      assert.notEqual(checked.code, 0);
      assert.match(checked.output, pointer);
    });
  });

  it("mobile 만 있어도 nativeFonts 를 확인한다", (t) => {
    const project = createProject(t, ["mobile"]);
    editTokens(project, (tokens) => withoutKey(tokens, "nativeFonts"));

    const { code, output } = runTokens(project);

    assert.notEqual(code, 0);
    assert.match(output, /nativeFonts/);
    assert.ok(!exists(project, APP_OUTPUT));
  });

  it("web 만 있으면 nativeFonts 가 없어도 생성·검사가 통과한다", (t) => {
    const project = createProject(t, ["web"]);
    editTokens(project, (tokens) => withoutKey(tokens, "nativeFonts"));

    assert.equal(runTokens(project).code, 0);

    assert.ok(exists(project, WEB_OUTPUT));
    assert.ok(!exists(project, "mobile"));
    assert.equal(runTokens(project, ["--check"]).code, 0);
  });
});

// 글자 눈금은 글꼴처럼 둘로 나뉜다. 웹 눈금(typography)은 type-<이름> 유틸리티로, 앱 눈금(nativeTypography)은
// theme 의 typography 로 나온다. 자간(tracking)은 전역 값 하나와 항목마다 따로 적는 값이 있고, 전역 값은 웹 body 의 자간이기도 하다.
describe("글자 눈금은 웹 유틸리티와 앱 typography 로 나온다", () => {
  const tokens = JSON.parse(readFileSync(join(root, "design/tokens.json"), "utf8"));
  const webTypeNames = Object.keys(tokens.typography);
  const appTypeNames = Object.keys(tokens.nativeTypography);
  // 임시 사본의 정본을 이 눈금으로 바꿔, 변환 결과를 글자 그대로 본다. 굵기가 있는 것과 없는 것 하나씩.
  const plainScale = {
    title: { size: 26, lineHeight: 35, weight: 700 },
    body: { size: 16, lineHeight: 26 },
  };
  const withWebScale = (current, tracking, typography = plainScale) => ({
    ...current,
    typography,
    tracking,
  });
  const withAppScale = (current, tracking, nativeTypography = plainScale) => ({
    ...current,
    nativeTypography,
    tracking,
  });
  const utilityBlock = (css, name) =>
    css.match(new RegExp(`^@utility type-${name} \\{\\n([\\s\\S]*?)\\n\\}$`, "m"))?.[1];
  const typographyBlock = (ts) =>
    ts.match(/^export const typography = \{\n([\s\S]*?)\n\} as const;$/m)?.[1];
  // @layer base 안의 body 규칙 본문.
  const bodyRule = (css) =>
    css.slice(css.indexOf("@layer base {")).match(/^  body \{\n([\s\S]*?)\n  \}$/m)?.[1];

  it("웹 CSS 는 정본의 이름마다 @utility type-<이름> 을 레이어 밖 최상위에 만든다", (t) => {
    const project = createProject(t, ["web", "mobile"]);
    runTokens(project);
    const css = read(project, WEB_OUTPUT);

    assert.ok(webTypeNames.includes("title"), "정본에 화면 제목 눈금(typography.title)이 없다");
    webTypeNames.forEach((name) =>
      assert.ok(utilityBlock(css, name), `@utility type-${name} 이 최상위에 없다`),
    );
    // @utility 는 @layer 안에 두면 Tailwind 가 빌드를 멈춘다.
    assert.ok(css.indexOf("@layer base {") > css.lastIndexOf("@utility "));
    assert.doesNotMatch(css.slice(css.indexOf("@layer base {")), /@utility/);
    // text-<이름>(--text-* 테마 변수)으로 만들면 cn 이 색 클래스와 합쳐 지운다.
    assert.doesNotMatch(css, /--text-/);
  });

  // 자간은 유틸리티마다 적는다. body 에만 두면 em 이 본문 크기로 px 이 되어 큰 제목이 눈금보다 벌어진다.
  it("웹 유틸리티는 크기를 rem, 줄 높이를 비율, 자간을 em 으로 적고 굵기는 있을 때만 적는다", (t) => {
    const project = createProject(t, ["web"]);
    editTokens(project, (current) => withWebScale(current, "-0.02em"));

    assert.equal(runTokens(project).code, 0);

    const css = read(project, WEB_OUTPUT);
    assert.equal(
      utilityBlock(css, "title"),
      [
        "  font-size: 1.625rem;",
        "  line-height: calc(35 / 26);",
        "  letter-spacing: -0.02em;",
        "  font-weight: 700;",
      ].join("\n"),
    );
    assert.equal(
      utilityBlock(css, "body"),
      ["  font-size: 1rem;", "  line-height: calc(26 / 16);", "  letter-spacing: -0.02em;"].join(
        "\n",
      ),
    );
  });

  // 큰 제목은 본문보다 자간을 더 좁힌다. 그래서 항목마다 tracking 을 따로 적을 수 있다.
  it("웹 유틸리티의 자간은 그 항목의 tracking 이고, 없는 항목과 body 요소는 전역 tracking 이다", (t) => {
    const project = createProject(t, ["web"]);
    editTokens(project, (current) =>
      withWebScale(current, "-0.01em", {
        title: { size: 24, lineHeight: 32, weight: 600, tracking: "-0.025em" },
        body: { size: 14, lineHeight: 22, tracking: "-0.005em" },
        caption: { size: 12, lineHeight: 16 },
      }),
    );

    assert.equal(runTokens(project).code, 0);

    const css = read(project, WEB_OUTPUT);
    assert.equal(
      utilityBlock(css, "title"),
      [
        "  font-size: 1.5rem;",
        "  line-height: calc(32 / 24);",
        "  letter-spacing: -0.025em;",
        "  font-weight: 600;",
      ].join("\n"),
    );
    assert.match(utilityBlock(css, "body"), /^  letter-spacing: -0\.005em;$/m);
    assert.match(utilityBlock(css, "caption"), /^  letter-spacing: -0\.01em;$/m);
    // body 요소의 자간은 눈금의 body 항목이 아니라 전역 값이다.
    assert.match(bodyRule(css), /^    letter-spacing: -0\.01em;$/m);
    assert.equal(runTokens(project, ["--check"]).code, 0);
  });

  it("웹 CSS 는 body 에 자간을 주고 고정폭 글자(code·kbd·samp·pre)는 0 으로 되돌린다", (t) => {
    const project = createProject(t, ["web"]);
    editTokens(project, (current) => withWebScale(current, "-0.03em"));

    assert.equal(runTokens(project).code, 0);

    const css = read(project, WEB_OUTPUT);
    const base = css.slice(css.indexOf("@layer base {"));
    assert.match(
      base,
      /^  body \{\n(?:    .*\n)*    letter-spacing: -0\.03em;\n(?:    .*\n)*  \}$/m,
    );
    assert.match(base, /^  code,\n  kbd,\n  samp,\n  pre \{\n    letter-spacing: 0;\n  \}$/m);
  });

  it("앱 theme 의 typography 는 크기·줄 높이·굵기(문자열)와 크기 × 자간을 담는다", (t) => {
    const project = createProject(t, ["mobile"]);
    editTokens(project, (current) => withAppScale(current, "-0.02em"));

    assert.equal(runTokens(project).code, 0);

    assert.equal(
      typographyBlock(read(project, APP_OUTPUT)),
      [
        '  title: { fontSize: 26, lineHeight: 35, fontWeight: "700", letterSpacing: -0.52 },',
        "  body: { fontSize: 16, lineHeight: 26, letterSpacing: -0.32 },",
      ].join("\n"),
    );
  });

  it("앱 typography 의 자간은 크기 × 그 항목의 tracking 이고, 없는 항목은 전역 tracking 이다", (t) => {
    const project = createProject(t, ["mobile"]);
    editTokens(project, (current) =>
      withAppScale(current, "-0.01em", {
        title: { size: 26, lineHeight: 35, weight: 700, tracking: "-0.02em" },
        body: { size: 16, lineHeight: 26 },
      }),
    );

    assert.equal(runTokens(project).code, 0);

    assert.equal(
      typographyBlock(read(project, APP_OUTPUT)),
      [
        '  title: { fontSize: 26, lineHeight: 35, fontWeight: "700", letterSpacing: -0.52 },',
        "  body: { fontSize: 16, lineHeight: 26, letterSpacing: -0.16 },",
      ].join("\n"),
    );
    assert.equal(runTokens(project, ["--check"]).code, 0);
  });

  it("앱 theme 의 typography 는 앱 눈금(nativeTypography)의 이름을 모두 담고, 자간은 소수 둘째 자리까지 적는다", (t) => {
    const project = createProject(t, ["web", "mobile"]);
    // 13 × -0.011 = -0.143 → -0.14
    editTokens(project, (current) => ({
      ...current,
      nativeTypography: { ...current.nativeTypography, caption: { size: 13, lineHeight: 20 } },
      tracking: "-0.011em",
    }));

    assert.equal(runTokens(project).code, 0);

    const block = typographyBlock(read(project, APP_OUTPUT));
    assert.ok(block, "앱 theme 에 typography 블록이 없다");
    // 앱 theme 의 키는 색과 같이 camelCase 다 (하이픈 이름을 더해도 이 시험이 따라간다).
    const appKey = (name) => name.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
    appTypeNames.forEach((name) =>
      assert.match(
        block,
        new RegExp(`^  ${appKey(name)}: \\{ fontSize: `, "m"),
        `typography.${name} 이 없다`,
      ),
    );
    assert.match(block, /^  caption: \{ fontSize: 13, lineHeight: 20, letterSpacing: -0\.14 \},$/m);
  });

  // 웹(조밀한 화면)과 앱(손가락으로 누르는 화면)은 눈금이 다르다. 한쪽을 고쳐도 다른 쪽 생성물은 그대로여야 한다.
  it("앱 typography 는 nativeTypography 에서 오고, 웹 눈금(typography)을 바꿔도 달라지지 않는다", (t) => {
    const project = createProject(t, ["web", "mobile"]);
    runTokens(project);
    const before = read(project, APP_OUTPUT);
    editTokens(project, (current) => ({
      ...current,
      typography: { lead: { size: 18, lineHeight: 28 } },
    }));

    assert.equal(runTokens(project).code, 0);

    assert.equal(read(project, APP_OUTPUT), before);
    // 두 눈금의 이름은 서로 달라도 된다: 웹에만 있는 이름은 앱에 생기지 않고, 앱에만 있는 이름은 웹에 생기지 않는다.
    const css = read(project, WEB_OUTPUT);
    assert.ok(utilityBlock(css, "lead"), "@utility type-lead 가 없다");
    assert.doesNotMatch(typographyBlock(before), /^  lead: /m);
    appTypeNames.forEach((name) =>
      assert.equal(utilityBlock(css, name), undefined, `앱 눈금의 ${name} 이 웹 CSS 에 생겼다`),
    );
    assert.equal(runTokens(project, ["--check"]).code, 0);
  });

  it("웹 유틸리티는 typography 에서 오고, 앱 눈금(nativeTypography)을 바꿔도 달라지지 않는다", (t) => {
    const project = createProject(t, ["web", "mobile"]);
    runTokens(project);
    const before = read(project, WEB_OUTPUT);
    editTokens(project, (current) => ({
      ...current,
      nativeTypography: { jumbo: { size: 40, lineHeight: 50, weight: 700, tracking: "-0.02em" } },
    }));

    assert.equal(runTokens(project).code, 0);

    assert.equal(read(project, WEB_OUTPUT), before);
    assert.equal(
      typographyBlock(read(project, APP_OUTPUT)),
      '  jumbo: { fontSize: 40, lineHeight: 50, fontWeight: "700", letterSpacing: -0.8 },',
    );
    assert.equal(runTokens(project, ["--check"]).code, 0);
  });
});

describe("글자 눈금(typography·nativeTypography·tracking)이 어긋나면 막는다", () => {
  const withType = (tokens, scale, name, entry) => ({
    ...tokens,
    [scale]: { ...tokens[scale], [name]: entry },
  });
  // [무엇이 어긋났나, 정본을 어떻게 망가뜨리나, 메시지가 짚어야 할 자리]
  // 머리 줄에도 typography·tracking 이라는 낱말이 나오므로, 통째로 없는 경우는 그 항목을 짚는 문장까지 본다.
  // 두 눈금은 항목의 모양이 같아서 같은 경우를 눈금마다 본다. 앞에 글자가 붙지 않은 이름만 맞춰,
  // typography 를 망가뜨렸는데 nativeTypography 를 짚는 메시지로 통과하는 일이 없게 한다.
  const at = (scale, rest) => new RegExp(`(?<![A-Za-z])${scale}${rest}`);
  const scaleCases = (scale) => [
    [
      `${scale} 가 통째로 없다`,
      (tokens) => withoutKey(tokens, scale),
      at(scale, " 항목이 없습니다"),
    ],
    [
      `${scale} 의 눈금 하나가 객체가 아니다`,
      (tokens) => withType(tokens, scale, "title", 26),
      at(scale, "\\.title "),
    ],
    [
      `${scale} 의 크기가 숫자가 아니다`,
      (tokens) => withType(tokens, scale, "title", { size: "26px", lineHeight: 35 }),
      at(scale, "\\.title\\.size"),
    ],
    [
      `${scale} 의 줄 높이가 빠졌다`,
      (tokens) => withType(tokens, scale, "title", { size: 26 }),
      at(scale, "\\.title\\.lineHeight"),
    ],
    [
      `${scale} 의 굵기가 100 단위 숫자가 아니다`,
      (tokens) => withType(tokens, scale, "title", { size: 26, lineHeight: 35, weight: "bold" }),
      at(scale, "\\.title\\.weight"),
    ],
    [
      `${scale} 의 항목 자간이 em 길이가 아니다`,
      (tokens) =>
        withType(tokens, scale, "title", { size: 26, lineHeight: 35, tracking: "-0.52px" }),
      at(scale, '\\.title\\.tracking 값 "-0\\.52px"'),
    ],
    [
      `${scale} 에 모르는 키가 있다(weight 의 오타)`,
      (tokens) => withType(tokens, scale, "title", { size: 26, lineHeight: 35, wieght: 700 }),
      at(scale, "\\.title\\.wieght"),
    ],
  ];
  const brokenCases = [
    ...scaleCases("typography"),
    ...scaleCases("nativeTypography"),
    ["tracking 이 없다", (tokens) => withoutKey(tokens, "tracking"), /tracking 항목이 없습니다/],
    [
      "tracking 이 em 길이가 아니다",
      (tokens) => ({ ...tokens, tracking: "-0.32px" }),
      /(?<![A-Za-z.])tracking 값 "-0\.32px"/,
    ],
  ];

  brokenCases.forEach(([title, breakTokens, pointer]) => {
    it(`${title} → 생성도 --check 도 그 자리를 짚어 실패하고, 생성물을 덮지 않는다`, (t) => {
      const project = createProject(t, ["web", "mobile"]);
      runTokens(project);
      const before = [WEB_OUTPUT, APP_OUTPUT].map((path) => read(project, path));
      editTokens(project, breakTokens);

      const generated = runTokens(project);
      const checked = runTokens(project, ["--check"]);

      assert.notEqual(generated.code, 0);
      assert.match(generated.output, pointer);
      assert.deepEqual(
        [WEB_OUTPUT, APP_OUTPUT].map((path) => read(project, path)),
        before,
      );
      assert.notEqual(checked.code, 0);
      assert.match(checked.output, pointer);
    });
  });

  // 글꼴(nativeFonts)과 같은 방식이다. 웹 눈금은 web 이 있을 때, 앱 눈금은 mobile 이 있을 때만 확인한다.
  // 전역 tracking 은 두 생성물이 모두 쓰므로 한쪽 폴더만 있어도 확인한다.
  [
    ["web", "typography", "nativeTypography", WEB_OUTPUT],
    ["mobile", "nativeTypography", "typography", APP_OUTPUT],
  ].forEach(([folder, ownScale, otherScale, output]) => {
    const otherFolder = folder === "web" ? "mobile" : "web";

    it(`${folder} 만 있어도 ${ownScale} 를 확인하고, 생성물을 만들지 않는다`, (t) => {
      const project = createProject(t, [folder]);
      editTokens(project, (tokens) => withoutKey(tokens, ownScale));

      const { code, output: message } = runTokens(project);

      assert.notEqual(code, 0);
      assert.match(message, at(ownScale, " 항목이 없습니다"));
      assert.ok(!exists(project, WEB_OUTPUT));
      assert.ok(!exists(project, APP_OUTPUT));
    });

    it(`${folder} 만 있으면 ${otherScale} 가 없어도 생성·검사가 통과한다`, (t) => {
      const project = createProject(t, [folder]);
      editTokens(project, (tokens) => withoutKey(tokens, otherScale));

      assert.equal(runTokens(project).code, 0);

      assert.ok(exists(project, output));
      assert.ok(!exists(project, otherFolder));
      assert.equal(runTokens(project, ["--check"]).code, 0);
    });

    it(`${folder} 만 있어도 전역 tracking 을 확인하고, 생성물을 만들지 않는다`, (t) => {
      const project = createProject(t, [folder]);
      editTokens(project, (tokens) => withoutKey(tokens, "tracking"));

      const { code, output: message } = runTokens(project);

      assert.notEqual(code, 0);
      assert.match(message, /tracking 항목이 없습니다/);
      assert.ok(!exists(project, WEB_OUTPUT));
      assert.ok(!exists(project, APP_OUTPUT));
    });
  });
});

// 글자와 그 바탕의 대비가 WCAG AA(본문 4.5:1) 아래로 내려가면 토큰을 고칠 때 바로 막는다.
// 계산은 WCAG 2.2 의 상대 휘도·대비 정의를 그대로 옮긴 순수 함수다.
// https://www.w3.org/TR/WCAG22/#dfn-relative-luminance · https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
describe("글자와 바탕의 대비가 WCAG AA(4.5:1) 이상이다", () => {
  const MIN_CONTRAST = 4.5;
  const { colors } = JSON.parse(readFileSync(join(root, "design/tokens.json"), "utf8"));

  // tokens.json 의 색은 앱(React Native)에도 그대로 들어가서 #RGB·#RRGGBB 로 적는다.
  // 다른 형식(oklch 등)이면 잴 수 없으니 넘기지 않고 실패한다 — 그 형식을 쓰려면 여기 변환부터 넓힌다.
  const parseHex = (value) => {
    const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
    if (!digits) {
      throw new Error(`대비를 잴 수 없는 색 형식이다: ${value} (#RGB·#RRGGBB 만 읽는다)`);
    }
    const pairs =
      digits.length === 3 ? [...digits].map((digit) => digit + digit) : digits.match(/../g);
    return pairs.map((pair) => Number.parseInt(pair, 16));
  };
  const toLinear = (channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const relativeLuminance = (rgb) => {
    const [red, green, blue] = rgb.map(toLinear);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const contrastRatio = (first, second) => {
    const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
      (a, b) => b - a,
    );
    return (lighter + 0.05) / (darker + 0.05);
  };
  // 반투명 바탕(bg-foreground/5)은 아래 바탕과 섞인 색이 글자 뒤의 실제 색이다. 브라우저처럼 sRGB 값으로 섞는다.
  const composite = (top, alpha, bottom) =>
    top.map((channel, index) => channel * alpha + bottom[index] * (1 - alpha));

  const tokenColor = (name) => {
    assert.ok(Object.hasOwn(colors, name), `design/tokens.json 에 ${name} 색이 없다`);
    return parseHex(colors[name]);
  };
  // 바탕: "이름" 은 토큰 그대로, { tint, alpha, over } 는 bg-<tint>/<alpha×100> 을 over 위에 합성한 색.
  const surfaceColor = (surface) =>
    typeof surface === "string"
      ? tokenColor(surface)
      : composite(tokenColor(surface.tint), surface.alpha, tokenColor(surface.over));
  const surfaceLabel = (surface) =>
    typeof surface === "string"
      ? surface
      : `${surface.over} 위 ${surface.tint} ${Math.round(surface.alpha * 100)}%`;

  // shadcn 짝: <이름>-foreground 는 <이름> 바탕 위 글자다. 짝을 새로 두면(destructive-foreground 등) 여기서 자동으로 잰다.
  const SUFFIX = "-foreground";
  const semanticPairs = Object.keys(colors)
    .filter((name) => name.endsWith(SUFFIX) && Object.hasOwn(colors, name.slice(0, -SUFFIX.length)))
    .map((name) => [name, name.slice(0, -SUFFIX.length), "shadcn 짝"]);
  // 짝 밖에서 실제로 글자가 놓이는 조합. 화면에 새 조합(반투명 바탕 등)을 쓰면 여기에 더한다.
  const usedPairs = [
    ["foreground", "background", "본문"],
    ["muted-foreground", "background", "보조 글자"],
    ["muted-foreground", "card", "카드 설명(CardDescription)"],
    ["foreground", "muted", "회색 바탕 위 화면 제목(main 의 bg-muted)"],
    ["muted-foreground", "muted", "회색 바탕 위 설명"],
    ["primary", "muted", "회색 바탕 위 문장 속 링크"],
    ["destructive", "muted", "앱: 카드 밖 오류 알림(Message)"],
    ["destructive", "background", "입력 오류 글자(FieldError)"],
    [
      "destructive",
      { tint: "destructive", alpha: 0.1, over: "background" },
      "위험 버튼(bg-destructive/10)",
    ],
    [
      "destructive",
      { tint: "destructive", alpha: 0.2, over: "background" },
      "위험 버튼 hover(bg-destructive/20)",
    ],
    ["brand", "background", "브랜드 색 글자·선택 표시"],
    [
      "brand",
      { tint: "brand", alpha: 0.1, over: "background" },
      "브랜드 색 옅은 바탕 위 글자(bg-brand/10)",
    ],
    ["muted-foreground", "sidebar", "사이드바 위 보조 글자"],
    ["muted-foreground", "sidebar-accent", "사이드바 hover·선택 항목 위 보조 글자"],
  ];

  it("대비 계산이 WCAG 기준값과 맞다", () => {
    assert.equal(contrastRatio(parseHex("#000000"), parseHex("#FFF")), 21);
    assert.equal(contrastRatio(parseHex("#2563EB"), parseHex("#2563eb")), 1);
    // #767676 은 흰 바탕에서 4.5:1 을 겨우 넘는 회색으로 널리 쓰는 기준값이다(4.54:1).
    assert.equal(contrastRatio(parseHex("#767676"), parseHex("#FFFFFF")).toFixed(2), "4.54");
    assert.deepEqual(composite([0, 0, 0], 0.5, [255, 255, 255]), [127.5, 127.5, 127.5]);
  });

  it("잴 수 없는 색 형식은 넘기지 않고 실패한다", () => {
    ["oklch(0.5 0.1 200)", "rgb(0 0 0)", "#12345", "#1234567"].forEach((value) =>
      assert.throws(() => parseHex(value), /대비를 잴 수 없는 색 형식/),
    );
  });

  it("shadcn 짝(<이름>-foreground)을 tokens.json 에서 찾는다", () => {
    assert.ok(semanticPairs.some(([text]) => text === "primary-foreground"));
    assert.ok(semanticPairs.some(([text]) => text === "card-foreground"));
    // 앱의 채움 버튼은 brand 바탕에 brand-foreground 글자다.
    assert.ok(semanticPairs.some(([text]) => text === "brand-foreground"));
  });

  // 회사가 색을 정해 둔 로그인 버튼은 대비 대신 그 회사의 지정 값과 같은지를 본다(2026-10-15 사용자 결정).
  // 네이버 로그인 버튼 가이드는 바탕 #03A94D·글자 흰색을 지정하고 바꾸지 말라고 한다. 흰 글자의 대비가 3.09:1 이라 4.5:1 에 못 미친다.
  // https://developers.naver.com/docs/login/bi/bi.md — 예외는 이 짝 하나뿐이고, 값이 가이드와 달라지면 실패한다.
  const BRAND_MANDATED = new Map([
    ["naver-foreground", { "naver-foreground": "#FFFFFF", naver: "#03A94D" }],
  ]);

  it("대비 예외(회사 지정 색)는 가이드의 값 그대로다", () => {
    for (const values of BRAND_MANDATED.values()) {
      for (const [name, value] of Object.entries(values)) {
        assert.equal(
          colors[name]?.toUpperCase(),
          value,
          `${name} 은 회사 가이드의 ${value} 여야 한다`,
        );
      }
    }
  });

  [...semanticPairs, ...usedPairs]
    .filter(
      ([text, surface]) =>
        !(
          BRAND_MANDATED.has(text) &&
          typeof surface === "string" &&
          Object.hasOwn(BRAND_MANDATED.get(text), surface)
        ),
    )
    .forEach(([text, surface, where]) => {
      it(`${text} / ${surfaceLabel(surface)} (${where})`, () => {
        const ratio = contrastRatio(tokenColor(text), surfaceColor(surface));

        assert.ok(
          ratio >= MIN_CONTRAST,
          `${text} 글자가 ${surfaceLabel(surface)} 바탕에서 ${ratio.toFixed(2)}:1 이다 — ${MIN_CONTRAST}:1 이상이 되게 design/tokens.json 을 고친다`,
        );
      });
    });
});
