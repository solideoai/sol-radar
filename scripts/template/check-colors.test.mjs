// 색 하드코딩 검사(scripts/check-colors.sh) 테스트. 실행: 루트에서 `pnpm test`
//
// 임시 폴더에 검사 스크립트와 화면 파일을 두고 돌린다. 어떤 표기를 막고, 무엇은 막지 않는지를 본다.
// 이 시험은 CI(Ubuntu, GNU 도구)와 macOS(BSD 도구) 양쪽에서 돈다. 둘이 같은 결과를 내야 한다.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

// 실패 메시지의 두 머리말. 팔레트 위반과 직접 적은 색을 따로 보여 주는지 확인하는 데 쓴다.
const PALETTE_HEADING = "Tailwind 기본 팔레트 클래스가 있습니다";
const COLOR_HEADING = "화면 코드에 색이 직접 적혀 있습니다";

const makeProject = (t, files) => {
  const project = mkdtempSync(join(tmpdir(), "check-colors-test-"));
  t.after(() => rmSync(project, { recursive: true, force: true }));

  mkdirSync(join(project, "scripts"));
  copyFileSync(join(root, "scripts/check-colors.sh"), join(project, "scripts/check-colors.sh"));
  Object.entries(files).forEach(([path, content]) => {
    mkdirSync(dirname(join(project, path)), { recursive: true });
    writeFileSync(join(project, path), content);
  });
  return project;
};

// 검사 한 번이 프로세스 스무 개쯤을 띄운다. Windows 는 프로세스 하나가 비싸서 하나씩 기다리면 이 파일만 몇 분이 걸린다.
// 그래서 기다리지 않고 걸어 두고(비동기), 같은 describe 의 시험을 함께 돌린다(PARALLEL).
const PARALLEL = { concurrency: true };
const run = (project) =>
  new Promise((resolve) =>
    execFile("bash", ["scripts/check-colors.sh"], { cwd: project }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code : 0, output: `${stdout}${stderr}` }),
    ),
  );

// files: { "web/app/page.tsx": "내용" } 처럼 상대 경로 → 내용
const runCheck = (t, files) => run(makeProject(t, files));

// 한 파일에 한 줄씩 적고, 걸린 줄 번호를 돌려준다. 여러 경우를 한 번 실행으로 본다.
const flaggedLines = (output, path) =>
  output
    .split("\n")
    .filter((line) => line.startsWith(`${path}:`))
    .map((line) => Number(line.slice(path.length + 1).split(":")[0]));

describe("화면 코드에 직접 적은 색을 막는다", PARALLEL, () => {
  // [표기, 코드, 파일 경로(기본 web/app/page.tsx)]
  const blocked = [
    ["#RRGGBB", 'const a = "#2563EB";'],
    ["#RGB", 'const a = "#fff";'],
    ["#RRGGBBAA", 'const a = "#2563EBFF";'],
    ["작은따옴표 안 #ABCDEF", "const a = '#ABCDEF';"],
    ["rgb()", 'const a = "rgb(0 0 0)";'],
    ["rgba()", 'const a = "rgba(0, 0, 0, 0.5)";'],
    ["hsl()", 'const a = "hsl(210 40% 50%)";'],
    ["hwb()", 'const a = "hwb(194 0% 0%)";'],
    ["lab()", 'const a = "lab(50% 40 59)";'],
    ["lch()", 'const a = "lch(50% 40 59)";'],
    ["oklab()", 'const a = "oklab(0.5 0 0)";'],
    ["oklch() — Tailwind 임의값 안", '<div className="bg-[oklch(0.5_0.1_200)]" />'],
    ["color(display-p3 …)", 'const a = "color(display-p3 1 0 0)";'],
    ["Tailwind 임의값 bg-[#fff]", '<div className="bg-[#fff]" />'],
    ["Tailwind 임의값 안 _ 뒤의 색", '<div className="shadow-[0_0_0_1px_#fff]" />'],
    ["Tailwind 임의값 안 _ 뒤의 rgba()", '<div className="shadow-[0_1px_rgba(0,0,0,0.1)]" />'],
    ['SVG 속성 fill="#fff"', '<path fill="#fff" />'],
    ['style 객체의 "#fff"', '<div style={{ color: "#fff" }} />'],
    ["CSS 의 color: #fff", ".title { color: #fff; }", "web/app/brand.css"],
    ["CSS 의 stroke: #2563EB", ".icon { stroke: #2563EB; }", "web/app/brand.css"],
  ];

  blocked.forEach(([notation, code, path = "web/app/page.tsx"]) => {
    it(`${notation} 를 막는다`, async (t) => {
      const { code: exitCode, output } = await runCheck(t, { [path]: `${code}\n` });

      assert.notEqual(exitCode, 0);
      assert.ok(output.includes(`${path}:1:`), output);
      assert.ok(output.includes(COLOR_HEADING), output);
      assert.ok(!output.includes(PALETTE_HEADING), output);
    });
  });

  it("앱 화면(mobile/app)도 검사한다", async (t) => {
    const { code } = await runCheck(t, {
      "mobile/app/index.tsx": 'const a = "oklch(0.5 0.1 200)";\n',
    });

    assert.notEqual(code, 0);
  });

  it("SVG 조각 참조와 같은 줄에 있는 진짜 색은 막는다", async (t) => {
    const { code, output } = await runCheck(t, {
      "web/app/page.tsx": '<path fill="url(#abc)" stroke="#fff" />\n',
    });

    assert.notEqual(code, 0);
    assert.ok(
      output.includes('web/app/page.tsx:1:<path fill="url(#abc)" stroke="#fff" />'),
      output,
    );
  });

  it("CSS 의 url(#…) 조각 참조는 넘기고 같은 규칙의 진짜 색은 막는다", async (t) => {
    const passed = await runCheck(t, { "web/app/brand.css": ".logo { fill: url(#cafe); }\n" });
    const blocked = await runCheck(t, {
      "web/app/brand.css": ".logo { fill: url(#cafe); stroke: #2563EB; }\n",
    });

    assert.equal(passed.code, 0, passed.output);
    assert.notEqual(blocked.code, 0);
  });

  it("앵커와 같은 줄에 있는 진짜 색은 막고, 줄은 원문 그대로 보여 준다", async (t) => {
    const { code, output } = await runCheck(t, {
      "web/app/page.tsx": '<a href="#add" style={{ color: "#fff" }} />\n',
    });

    assert.notEqual(code, 0);
    assert.ok(
      output.includes('web/app/page.tsx:1:<a href="#add" style={{ color: "#fff" }} />'),
      output,
    );
  });
});

describe("색이 아닌 '#' 은 통과시킨다 — 앵커·URL 조각·HTML 문자 참조", PARALLEL, () => {
  const allowed = [
    ['앵커 href="#add"', '<a href="#add">추가</a>'],
    ['라우터 링크 to="#bad"', '<Link to="#bad">이동</Link>'],
    ["중괄호 안 앵커", '<a href={"#add"} />'],
    ["템플릿 문자열 앵커", "<a href={`#fed`} />"],
    ["객체의 href", 'const nav = [{ label: "추가", href: "#add" }];'],
    ["location.hash", 'location.hash = "#bed";'],
    ["SVG 스프라이트 xlinkHref", '<use xlinkHref="#fab" />'],
    ["경로 뒤 URL 조각", 'const url = "/docs#fed";'],
    ["절대 주소의 URL 조각", 'const url = "https://example.com/#cafe00";'],
    ["HTML 문자 참조", 'const brace = "&#123;";'],
    ["하이픈이 이어지는 앵커 이름", 'scrollTo("#add-item");'],
    ['SVG 조각 참조 fill="url(#abc)"', '<path fill="url(#abc)" />'],
    ["따옴표 안 SVG 조각 참조", "<rect mask=\"url('#facade')\" />"],
    ["style 객체의 SVG 조각 참조", '<g style={{ clipPath: "url(#decade)" }} />'],
    ["Tailwind 임의값 안 SVG 조각 참조", '<path className="fill-[url(#bead)]" />'],
  ];

  allowed.forEach(([name, code]) => {
    it(`${name}`, async (t) => {
      const { code: exitCode, output } = await runCheck(t, { "web/app/page.tsx": `${code}\n` });

      assert.equal(exitCode, 0, output);
    });
  });
});

describe("Tailwind 기본 팔레트 클래스를 막는다 (웹만)", PARALLEL, () => {
  const HUES = [
    "slate",
    "gray",
    "zinc",
    "neutral",
    "stone",
    "red",
    "orange",
    "amber",
    "yellow",
    "lime",
    "green",
    "emerald",
    "teal",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "rose",
  ];
  const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
  const UTILITIES = [
    "bg",
    "text",
    "border",
    "border-x",
    "border-y",
    "border-t",
    "border-r",
    "border-b",
    "border-l",
    "border-s",
    "border-e",
    "ring",
    "ring-offset",
    "outline",
    "fill",
    "stroke",
    "from",
    "via",
    "to",
    "shadow",
    "inset-shadow",
    "drop-shadow",
    "text-shadow",
    "divide",
    "placeholder",
    "caret",
    "accent",
    "decoration",
  ];

  // 이름 목록 하나하나를 한 줄씩 적고, 모든 줄이 걸렸는지 본다.
  const assertEveryLineFlagged = async (t, classes) => {
    const path = "web/app/page.tsx";
    const source = classes.map((name) => `<div className="${name}" />`).join("\n");
    const { code, output } = await runCheck(t, { [path]: `${source}\n` });

    assert.notEqual(code, 0);
    assert.deepEqual(
      flaggedLines(output, path),
      classes.map((_, index) => index + 1),
      output,
    );
    assert.ok(output.includes(PALETTE_HEADING), output);
    assert.ok(!output.includes(COLOR_HEADING), output);
  };

  it("팔레트 이름 22개를 모두 잡는다", async (t) => {
    await assertEveryLineFlagged(
      t,
      HUES.map((hue) => `bg-${hue}-500`),
    );
  });

  it("단계 50·100~900·950 과 white·black 을 모두 잡는다", async (t) => {
    await assertEveryLineFlagged(t, [
      ...SHADES.map((shade) => `text-red-${shade}`),
      "bg-white",
      "text-black",
    ]);
  });

  it("색을 받는 유틸리티를 모두 잡는다", async (t) => {
    await assertEveryLineFlagged(
      t,
      UTILITIES.map((utility) => `${utility}-sky-500`),
    );
  });

  const variants = [
    ["투명도 /50", "bg-black/50"],
    ["임의 투명도 /[0.5]", "bg-white/[0.5]"],
    ["hover: 접두", "hover:bg-red-500"],
    ["반응형 md: 접두", "md:text-slate-950"],
    ["dark: 접두", "dark:border-gray-200"],
    ["겹친 접두와 투명도", "md:hover:bg-zinc-900/80"],
    ["임의 변형 접두", "[&>svg]:fill-white"],
    ["앞에 붙인 중요 표시 !", "!bg-red-500"],
    ["뒤에 붙인 중요 표시 !", "bg-red-500!"],
  ];

  variants.forEach(([name, className]) => {
    it(`${name} (${className}) 가 붙어도 잡는다`, async (t) => {
      const { code, output } = await runCheck(t, {
        "web/app/page.tsx": `<div className="p-2 ${className} text-sm" />\n`,
      });

      assert.notEqual(code, 0);
      assert.ok(output.includes("web/app/page.tsx:1:"), output);
    });
  });

  it("cn()·cva 문자열과 CSS 의 @apply 도 잡는다", async (t) => {
    const { code, output } = await runCheck(t, {
      "web/components/badge.tsx": 'export const badge = cn("rounded", isError && "text-white");\n',
      "web/app/brand.css": ".badge {\n  @apply bg-rose-600;\n}\n",
    });

    assert.notEqual(code, 0);
    assert.ok(output.includes("web/components/badge.tsx:1:"), output);
    assert.ok(output.includes("web/app/brand.css:2:"), output);
  });

  it("팔레트 위반과 직접 적은 색을 나눠 보여 준다", async (t) => {
    const { code, output } = await runCheck(t, {
      "web/app/page.tsx": '<div className="bg-red-500" />\n<div style={{ color: "#fff" }} />\n',
    });
    const [paletteSection, colorSection] = output.split(COLOR_HEADING);

    assert.notEqual(code, 0);
    assert.ok(paletteSection.includes(PALETTE_HEADING), output);
    assert.ok(paletteSection.includes("web/app/page.tsx:1:"), output);
    assert.ok(!paletteSection.includes("web/app/page.tsx:2:"), output);
    assert.ok(colorSection.includes("web/app/page.tsx:2:"), output);
    assert.ok(!colorSection.includes("web/app/page.tsx:1:"), output);
    assert.ok(output.includes("design/tokens.json 에 추가하고 pnpm tokens"), output);
  });
});

describe("토큰을 쓰는 코드는 통과시킨다", PARALLEL, () => {
  const allowed = [
    ["토큰 클래스", '<div className="bg-primary text-primary-foreground" />'],
    ["토큰 원본 변수", 'const style = { background: "var(--popover)" };'],
    [
      "color-mix 의 보간 색공간 이름",
      '<div className="hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]" />',
    ],
    ["이름에 lab·color 가 든 함수", "const label = getLabel(theme.color(name));"],
    [
      "투명도·변형이 붙은 토큰 클래스",
      '<div className="bg-foreground/10 text-muted-foreground border-border ring-ring/50 hover:bg-accent dark:bg-card" />',
    ],
    [
      "색이 아닌 정적 유틸리티",
      '<div className="bg-transparent bg-current text-inherit fill-current stroke-none border-transparent outline-hidden" />',
    ],
    [
      "색이 아닌 같은 이름의 유틸리티",
      '<div className="text-sm border-2 border-x-4 ring-2 ring-offset-2 shadow-sm inset-shadow-sm drop-shadow-md text-shadow-lg outline-none divide-x from-10% to-90% decoration-2" />',
    ],
    [
      "다른 단어 일부로 들어간 팔레트 이름",
      'const a = ["nav-bg-white", "/img/bg-black.png", "fade-to-white", "my_text-white", "bg-white-smoke"];',
    ],
  ];

  allowed.forEach(([name, code]) => {
    it(`${name}`, async (t) => {
      const { code: exitCode, output } = await runCheck(t, { "web/app/page.tsx": `${code}\n` });

      assert.equal(exitCode, 0, output);
    });
  });

  it("앱(mobile)은 Tailwind 를 쓰지 않으므로 팔레트 이름을 보지 않는다", async (t) => {
    const { code, output } = await runCheck(t, {
      "mobile/app/index.tsx": 'const a = "bg-red-500 text-white";\n',
    });

    assert.equal(code, 0, output);
  });

  it("tokens.json 에 같은 이름으로 둔 색은 토큰 클래스로 본다", async (t) => {
    const { code, output } = await runCheck(t, {
      "design/tokens.json": JSON.stringify({ colors: { white: "#FFFFFF" } }, null, 2),
      "web/app/page.tsx": '<div className="bg-white" />\n<div className="text-black" />\n',
    });

    assert.notEqual(code, 0);
    assert.deepEqual(flaggedLines(output, "web/app/page.tsx"), [2], output);
  });

  it("colors 밖의 키(글꼴 등)가 같은 이름이어도 토큰 클래스로 보지 않는다", async (t) => {
    const { code, output } = await runCheck(t, {
      "design/tokens.json": JSON.stringify(
        { colors: { primary: "#2563EB" }, nativeFonts: { white: { ios: "System" } } },
        null,
        2,
      ),
      "web/app/page.tsx": '<div className="bg-white" />\n',
    });

    assert.notEqual(code, 0);
    assert.deepEqual(flaggedLines(output, "web/app/page.tsx"), [1], output);
  });
});

describe("검사 범위", PARALLEL, () => {
  it("등록하지 않은 새 폴더(web/features·mobile/features)도 검사한다", async (t) => {
    const { code, output } = await runCheck(t, {
      "web/features/cart/cart-item.tsx": '<div className="bg-red-500" />\n',
      "web/features/cart/price.ts": 'export const tone = "#fff";\n',
      "mobile/features/cart/index.tsx": 'const a = "rgb(0 0 0)";\n',
    });

    assert.notEqual(code, 0);
    assert.ok(output.includes("web/features/cart/cart-item.tsx:1:"), output);
    assert.ok(output.includes("web/features/cart/price.ts:1:"), output);
    assert.ok(output.includes("mobile/features/cart/index.tsx:1:"), output);
  });

  it("이름에 공백·한글이 든 파일도 검사한다", async (t) => {
    const { code, output } = await runCheck(t, {
      "web/app/(마케팅)/새 페이지.tsx": 'const a = "#fff";\n',
      "web/app/(마케팅)/팔레트 예시.tsx": '<div className="text-white" />\n',
    });

    assert.notEqual(code, 0);
    assert.ok(output.includes("web/app/(마케팅)/새 페이지.tsx:1:"), output);
    assert.ok(output.includes("web/app/(마케팅)/팔레트 예시.tsx:1:"), output);
  });

  it("프로젝트 안쪽의 *.config.* 는 앱 코드라서 검사한다", async (t) => {
    const { code, output } = await runCheck(t, {
      "web/lib/theme.config.ts": 'export const brand = "#2563EB";\n',
    });

    assert.notEqual(code, 0);
    assert.ok(output.includes("web/lib/theme.config.ts:1:"), output);
  });

  it("빌드 결과 폴더와 이름이 같은 안쪽 경로 폴더(app/coverage·app/build)는 검사한다", async (t) => {
    const { code, output } = await runCheck(t, {
      "web/app/coverage/page.tsx": 'const a = "#fff";\n',
      "web/app/build/page.tsx": '<div className="bg-red-500" />\n',
    });

    assert.notEqual(code, 0);
    assert.ok(output.includes("web/app/coverage/page.tsx:1:"), output);
    assert.ok(output.includes("web/app/build/page.tsx:1:"), output);
  });

  it("web·mobile 이 둘 다 없으면 검사할 것이 없다고 알리고 통과한다", async (t) => {
    const { code, output } = await runCheck(t, { "README.md": "# 빈 프로젝트\n" });

    assert.equal(code, 0);
    assert.match(output, /검사할 화면 코드 없음/);
  });

  // 직접 적은 색과 팔레트 클래스를 둘 다 넣는다. 예외가 아니면 둘 중 하나에는 걸린다.
  const VIOLATION = 'const a = "#fff"; const b = "bg-red-500";\n';
  const excluded = [
    ["생성물 web/app/globals.css", "web/app/globals.css"],
    ["생성물 mobile/theme/tokens.ts", "mobile/theme/tokens.ts"],
    ["생성물 web/lib/database.types.ts", "web/lib/database.types.ts"],
    ["생성물 mobile/lib/database.types.ts", "mobile/lib/database.types.ts"],
    ["시험 파일 *.test.*", "web/app/page.test.tsx"],
    ["시험 파일 *.spec.*", "web/lib/format.spec.ts"],
    ["앱 시험 파일", "mobile/lib/format.test.ts"],
    ["e2e 폴더", "web/e2e/fixtures.ts"],
    ["웹 도구 설정 *.config.*", "web/next.config.ts"],
    ["Tailwind 설정", "web/tailwind.config.js"],
    ["앱 도구 설정 *.config.*", "mobile/app.config.ts"],
    ["node_modules", "web/node_modules/pkg/index.js"],
    [".next", "web/.next/static/chunk.js"],
    [".expo", "mobile/.expo/web/cache.js"],
    [".vercel", "web/.vercel/output/static/app.css"],
    ["out", "web/out/index.js"],
    ["dist", "mobile/dist/_expo/static/js/web/entry.js"],
    ["build", "web/build/server.js"],
    ["coverage", "web/coverage/lcov-report/prettify.js"],
    ["playwright-report", "web/playwright-report/trace/index.js"],
    ["test-results", "web/test-results/run/report.js"],
    ["소스가 아닌 확장자(.svg)", "web/public/logo.svg"],
    ["소스가 아닌 확장자(.md)", "web/README.md"],
  ];

  excluded.forEach(([name, path]) => {
    it(`${name} 는 검사하지 않는다`, async (t) => {
      const { code, output } = await runCheck(t, {
        [path]: VIOLATION,
        "web/app/page.tsx": "export {};\n",
      });

      assert.equal(code, 0, output);
    });
  });

  it("생성물(globals.css)의 값은 검사하지 않는다", async (t) => {
    const { code } = await runCheck(t, {
      "web/app/globals.css": ":root { --primary: #2563EB; }\n",
    });

    assert.equal(code, 0);
  });

  // 읽지 못한 파일을 '못 찾음'으로 넘기면 검사가 조용히 초록불이 된다. root 는 권한과 무관하게 읽으므로 건너뛴다.
  it(
    "읽을 수 없는 파일이 있으면 통과시키지 않는다",
    { skip: process.getuid?.() === 0 },
    async (t) => {
      const project = makeProject(t, { "web/app/page.tsx": 'const a = "#fff";\n' });
      chmodSync(join(project, "web/app/page.tsx"), 0o000);

      const { code } = await run(project);

      assert.notEqual(code, 0);
    },
  );
});
