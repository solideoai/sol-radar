#!/usr/bin/env node
// tokens-gen.mjs — design/tokens.json 하나에서 웹 CSS와 앱 theme 를 만든다.
//
//   pnpm tokens          생성
//   pnpm tokens --check  생성물이 정본과 어긋나는지만 검사 (게이트·CI용)
//
// 색·글자 눈금을 두 곳에 적으면 반드시 어긋난다. 그래서 적는 곳을 하나로 두고 나머지는 만들어 낸다.
// 이 스크립트가 만든 파일은 손으로 고치지 않는다 — 다음 생성에서 덮인다.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const tokens = JSON.parse(readFileSync(join(root, "design/tokens.json"), "utf8"));
const banner = "이 파일은 design/tokens.json 에서 생성됩니다. 손으로 고치지 마세요 (pnpm tokens).";

const colorNames = Object.keys(tokens.colors);

// 웹은 shadcn 이 기대하는 모양으로 만든다. 값은 :root 의 원본 변수(--primary)에 두고,
// Tailwind 클래스(bg-primary)는 @theme inline 으로 그 변수에 잇는다. shadcn 컴포넌트가
// var(--popover)·var(--radius) 처럼 원본 변수를 직접 부르기 때문에 둘 다 있어야 한다.
const rootVars = [
  ...Object.entries(tokens.colors).map(([name, value]) => `  --${name}: ${value};`),
  `  --radius: ${tokens.radius};`,
].join("\n");
const themeColors = colorNames.map((name) => `  --color-${name}: var(--${name});`).join("\n");
const radiusScale = [
  ["sm", 0.6],
  ["md", 0.8],
  ["lg", 1],
  ["xl", 1.4],
  ["2xl", 1.8],
  ["3xl", 2.2],
  ["4xl", 2.6],
]
  .map(([size, ratio]) => `  --radius-${size}: calc(var(--radius) * ${ratio});`)
  .join("\n");
const themeFonts = Object.entries(tokens.fonts)
  .map(([name, value]) => `  --font-${name}: ${value};`)
  .join("\n");

// 웹 글자 눈금(typography)은 이름마다 type-<이름> 유틸리티로 만든다. 크기는 rem(px ÷ 16), 줄 높이는 크기에 대한 비율이다.
// 자간은 그 항목의 tracking 이고, 없으면 전역 tracking 이다.
// text-<이름>(--text-* 테마 변수)으로 만들지 않는다 — cn 이 낯선 text-* 를 색으로 보고 text-foreground 같은
// 색 클래스와 합쳐 지운다. Tailwind 기본 눈금(text-sm 등)은 shadcn 부품이 쓰므로 그대로 둔다.
const typeUtility = ([name, { size, lineHeight, weight, tracking = tokens.tracking }]) =>
  [
    `@utility type-${name} {`,
    `  font-size: ${size / 16}rem;`,
    `  line-height: calc(${lineHeight} / ${size});`,
    `  letter-spacing: ${tracking};`,
    ...(weight === undefined ? [] : [`  font-weight: ${weight};`]),
    "}",
  ].join("\n");

// --color-*: initial — Tailwind 기본 팔레트(bg-red-500·text-white 등)를 지운다. 정본에 없는 색은 클래스로도 못 쓴다.
// @custom-variant dark — dark: 는 .dark 클래스 아래에서만 켠다. 지금 토큰은 라이트뿐이라,
//   OS 다크 모드가 컴포넌트의 dark: 스타일만 반쯤 켜는 일을 막는다.
// @utility type-* — 레이어 밖 최상위에 둔다(안에 넣으면 Tailwind 가 빌드를 멈춘다). 그래야 sm:type-display 같은 변형이 붙는다.
// letter-spacing — 자간(tracking)은 body 와 type-* 에 같이 준다. em 은 적힌 요소의 글자 크기로 px 이 정해지고 자식은 그 px 을
//   물려받는다. body 에만 주면 큰 제목도 본문 크기로 계산한 자간을 받아 눈금보다 벌어진다.
//   body 는 전역 tracking 이고, type-* 는 항목마다 따로 적은 자간이 있으면 그 값이다.
//   고정폭 글자는 칸이 맞아야 하니 code·kbd·samp·pre 는 0 으로 되돌린다.
// typography·tracking 을 확인한 뒤에만 부른다.
const buildCss = () => `/* ${banner} */
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

:root {
${rootVars}
}

@theme inline {
  --color-*: initial;
${themeColors}
${radiusScale}
}

@theme {
${themeFonts}
  --font-heading: var(--font-sans);
}

${Object.entries(tokens.typography).map(typeUtility).join("\n\n")}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground font-sans;
    letter-spacing: ${tokens.tracking};
  }
  code,
  kbd,
  samp,
  pre {
    letter-spacing: 0;
  }
}
`;

// 앱 theme 의 키는 JS 이름이어야 한다: muted-foreground → mutedForeground
const camelCase = (name) => name.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());

// 앱 글꼴은 웹 글꼴(fonts)을 그대로 쓸 수 없다. React Native 의 fontFamily 는 CSS 처럼 후보 목록을
// 받지 못하고 글꼴 이름 하나만 받는다. 목록을 넘기면 오류 없이 기본 글꼴로 나오고 expo export 도
// 못 잡는다. 그래서 정본에 nativeFonts 를 따로 두고, 앱 생성물은 거기서 플랫폼마다 이름 하나를 고른다.
const nativePlatforms = ["ios", "android"];
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const entryExample = '{ "ios": "System", "android": "sans-serif" }';

// 어긋난 곳마다 "어디를 어떻게 고치라"는 한 줄을 돌려준다. 빈 배열이면 통과.
const nativeFontProblems = (fonts, nativeFonts) => {
  if (!isRecord(nativeFonts)) {
    return [
      `nativeFonts 항목이 없습니다 — fonts 의 키(${Object.keys(fonts).join("·")})마다 ${entryExample} 처럼 적으세요.`,
    ];
  }
  const entryProblems = Object.keys(fonts).flatMap((name) => {
    const entry = nativeFonts[name];
    if (!isRecord(entry)) {
      return [`nativeFonts.${name} 항목이 없습니다 — ${entryExample} 처럼 추가하세요.`];
    }
    return nativePlatforms.flatMap((platform) => {
      const value = entry[platform];
      const where = `nativeFonts.${name}.${platform}`;
      if (typeof value !== "string" || value.trim() === "") {
        return [`${where} 값이 없거나 비어 있습니다 — 그 플랫폼의 글꼴 이름 하나를 적으세요.`];
      }
      // 쉼표 목록과 따옴표는 CSS 문법이다. 웹 fonts 의 값을 옮겨 적은 실수를 여기서 잡는다.
      if (/[,'"]/.test(value)) {
        return [
          `${where} 값 ${JSON.stringify(value)} 는 글꼴 이름 하나가 아닙니다 — 쉼표·따옴표 없이 이름 하나만 적으세요 (후보 목록은 웹용 fonts 에만 씁니다).`,
        ];
      }
      return [];
    });
  });
  // fonts 에 없는 키는 생성물에 들어가지 않고 조용히 버려진다. 오타일 가능성이 높으니 막는다.
  const strayProblems = Object.keys(nativeFonts)
    .filter((name) => !Object.hasOwn(fonts, name))
    .map(
      (name) =>
        `nativeFonts.${name} 는 fonts 에 없는 키입니다 — fonts 에 웹 글꼴 목록을 함께 추가하거나 이 항목을 지우세요.`,
    );
  return [...entryProblems, ...strayProblems];
};

// default 는 ios·android 밖의 플랫폼용이고, 있어야 Platform.select 의 타입이 string 이 된다
// (없으면 string | undefined). android 값(sans-serif·monospace 같은 일반 이름)을 그대로 쓴다.
const nativeFontLine = (name, { ios, android }) =>
  `  ${name}: Platform.select({ ios: ${JSON.stringify(ios)}, android: ${JSON.stringify(android)}, default: ${JSON.stringify(android)} }),`;

// 글자 눈금은 글꼴처럼 둘로 나눈다: 웹 생성물은 typography, 앱 생성물은 nativeTypography 에서 나온다.
// 웹(조밀한 화면)과 앱(손가락으로 누르는 화면)은 크기가 달라서 한 눈금을 같이 쓰지 않는다. 두 눈금의 이름은 서로 달라도 된다.
// 항목의 모양은 같다. 크기·줄 높이는 px 숫자로 적는다 — 웹은 rem·비율로 바꾸고 앱은 그대로 쓴다.
// 굵기는 앱의 fontWeight 가 받는 100 단위만 받는다.
// 자간은 em 길이만 받는다. 앱의 letterSpacing 은 em 을 몰라 크기 × 자간으로 계산해야 한다.
// 자간은 항목마다 tracking 으로 따로 적을 수 있고, 없으면 전역 tracking 을 쓴다. 전역 tracking 은 웹 body 의 자간이기도 하다.
const typeKeys = ["size", "lineHeight", "weight", "tracking"];
const typeWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
const trackingPattern = /^-?\d+(\.\d+)?em$/;
const typeExample = '{ "size": 26, "lineHeight": 35, "weight": 700 }';
const isPositiveNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0;
const isTracking = (value) => typeof value === "string" && trackingPattern.test(value);

// nativeFontProblems 와 같은 약속이다: 어긋난 곳마다 한 줄, 빈 배열이면 통과.
const trackingProblems = (tracking) => {
  if (isTracking(tracking)) return [];
  return [
    tracking === undefined
      ? 'tracking 항목이 없습니다 — "-0.02em" 처럼 em 길이로 적으세요.'
      : `tracking 값 ${JSON.stringify(tracking)} 는 em 길이가 아닙니다 — "-0.02em" 처럼 적으세요.`,
  ];
};

// key 는 정본의 눈금 이름(typography·nativeTypography)이고, 메시지가 그 자리를 짚는 데 쓴다.
const typeScaleProblems = (key, scale) => {
  if (!isRecord(scale)) {
    return [`${key} 항목이 없습니다 — { "title": ${typeExample} } 처럼 이름마다 적으세요.`];
  }
  return Object.entries(scale).flatMap(([name, entry]) => {
    const where = `${key}.${name}`;
    if (!isRecord(entry)) {
      return [`${where} 값이 객체가 아닙니다 — ${typeExample} 처럼 적으세요.`];
    }
    const sizeProblems = ["size", "lineHeight"]
      .filter((field) => !isPositiveNumber(entry[field]))
      .map(
        (field) =>
          `${where}.${field} 값이 없거나 0보다 큰 숫자가 아닙니다 — 단위 없이 px 숫자로 적으세요.`,
      );
    const weightProblems =
      entry.weight === undefined || typeWeights.includes(entry.weight)
        ? []
        : [
            `${where}.weight 값 ${JSON.stringify(entry.weight)} 는 쓸 수 없는 굵기입니다 — 100~900 을 100 단위 숫자로 적거나, 보통 굵기면 지우세요.`,
          ];
    const itemTrackingProblems =
      entry.tracking === undefined || isTracking(entry.tracking)
        ? []
        : [
            `${where}.tracking 값 ${JSON.stringify(entry.tracking)} 는 em 길이가 아닙니다 — "-0.02em" 처럼 적거나, 전역 tracking 을 쓰려면 지우세요.`,
          ];
    // 모르는 키는 생성물에 들어가지 않고 조용히 버려진다. weight 의 오타면 굵기만 빠진 채 통과한다.
    const strayProblems = Object.keys(entry)
      .filter((field) => !typeKeys.includes(field))
      .map((field) => `${where}.${field} 는 모르는 키입니다 — ${typeKeys.join("·")} 만 씁니다.`);
    return [...sizeProblems, ...weightProblems, ...itemTrackingProblems, ...strayProblems];
  });
};

// 앱의 letterSpacing 은 크기 × 자간(em)을 소수 둘째 자리까지 적는다. fontWeight 는 문자열("700")이어야 한다.
// 자간은 그 항목의 tracking 이고, 없으면 전역 tracking 이다.
const nativeTypeLine = ([name, { size, lineHeight, weight, tracking = tokens.tracking }]) => {
  const fields = [
    `fontSize: ${size}`,
    `lineHeight: ${lineHeight}`,
    ...(weight === undefined ? [] : [`fontWeight: "${weight}"`]),
    `letterSpacing: ${Number((size * Number.parseFloat(tracking)).toFixed(2))}`,
  ];
  return `  ${camelCase(name)}: { ${fields.join(", ")} },`;
};

// nativeFonts·nativeTypography·tracking 을 확인한 뒤에만 부른다 — 앱 폴더가 없으면 아예 만들지 않는다.
const buildAppTheme = () => `// ${banner}
import { Platform } from "react-native";

export const colors = {
${Object.entries(tokens.colors)
  .map(([k, v]) => `  ${camelCase(k)}: "${v}",`)
  .join("\n")}
} as const;

// fontFamily 는 글꼴 이름 하나만 받으므로 플랫폼마다 하나를 고른다 (정본: tokens.json 의 nativeFonts).
export const fonts = {
${Object.keys(tokens.fonts)
  .map((name) => nativeFontLine(name, tokens.nativeFonts[name]))
  .join("\n")}
} as const;

// 글자 눈금. letterSpacing 은 크기 × 자간이다 (정본: tokens.json 의 nativeTypography·tracking).
export const typography = {
${Object.entries(tokens.nativeTypography).map(nativeTypeLine).join("\n")}
} as const;

export type ColorName = keyof typeof colors;
`;

// 웹·앱 중 한쪽만 쓰는 프로젝트도 있다. package.json 이 없는 폴더의 생성물은 만들지도 검사하지도 않는다.
const hasApp = (rel) => existsSync(join(root, rel.split("/")[0], "package.json"));

// 앱 글꼴은 생성·검사 모두에서 먼저 확인한다. 어긋나면 아무것도 쓰지 않고 멈춘다.
const fontProblems = hasApp("mobile") ? nativeFontProblems(tokens.fonts, tokens.nativeFonts) : [];
if (fontProblems.length > 0) {
  console.error("❌ design/tokens.json 의 앱 글꼴(nativeFonts)이 어긋납니다:");
  fontProblems.forEach((problem) => console.error(`   ${problem}`));
  console.error(
    "   앱(React Native)의 fontFamily 는 글꼴 이름 하나만 받습니다. 쉼표 목록을 넣으면 오류 없이 기본 글꼴로 나옵니다.",
  );
  process.exit(1);
}

// 글자 눈금도 같은 방식으로 먼저 확인한다. 웹 눈금(typography)은 web 이 있을 때, 앱 눈금(nativeTypography)은
// mobile 이 있을 때만 본다. 전역 tracking 은 두 생성물이 모두 쓰므로 만들 생성물이 하나라도 있으면 본다.
const typeProblems = [
  ...(hasApp("web") ? typeScaleProblems("typography", tokens.typography) : []),
  ...(hasApp("mobile") ? typeScaleProblems("nativeTypography", tokens.nativeTypography) : []),
  ...(hasApp("web") || hasApp("mobile") ? trackingProblems(tokens.tracking) : []),
];
if (typeProblems.length > 0) {
  console.error(
    "❌ design/tokens.json 의 글자 눈금(typography·nativeTypography·tracking)이 어긋납니다:",
  );
  typeProblems.forEach((problem) => console.error(`   ${problem}`));
  console.error(
    "   웹의 type-<이름> 클래스는 typography 에서, 앱의 typography 는 nativeTypography 에서 나옵니다. 크기·줄 높이는 px 숫자, 자간은 em 길이입니다.",
  );
  process.exit(1);
}

const outputs = [
  ["web/app/globals.css", buildCss],
  ["mobile/theme/tokens.ts", buildAppTheme],
]
  .filter(([rel]) => hasApp(rel))
  .map(([rel, build]) => [rel, build()]);

const drift = outputs.filter(([rel, want]) => {
  const path = join(root, rel);
  return !existsSync(path) || readFileSync(path, "utf8") !== want;
});

if (check) {
  if (drift.length > 0) {
    console.error("❌ 디자인 토큰 생성물이 정본과 어긋납니다:");
    drift.forEach(([rel]) => console.error(`   ${rel}`));
    console.error("   design/tokens.json 을 고쳤으면 `pnpm tokens` 를 돌려 반영하세요.");
    console.error("   생성물을 직접 고쳤다면 그 수정은 tokens.json 으로 옮겨야 합니다.");
    process.exit(1);
  }
  console.log("✓ 디자인 토큰 일치 — 정본 design/tokens.json");
  process.exit(0);
}

outputs.forEach(([rel, content]) => {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  console.log(`생성: ${rel}`);
});
