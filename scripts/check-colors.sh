#!/bin/bash
# 화면 코드에 색을 직접 적었거나 Tailwind 기본 팔레트 클래스를 썼으면 실패한다.
#
# 색의 정본은 design/tokens.json 하나다. 화면에서는 생성된 토큰만 쓴다
# (웹: Tailwind 토큰 클래스 또는 var(--이름), 앱: theme/tokens.ts 의 colors).
#
# 1. 직접 적은 색: #RGB · #RRGGBB · #RRGGBBAA · rgb()/rgba() · hsl()/hsla() · hwb() · lab()/lch() · oklab()/oklch() · color(<색공간> …)
#    shadcn 테마와 예제는 oklch() 를 쓰므로, 복사해 온 값이 그대로 박히는 것도 막는다.
#    '#' 뒤 16진수는 앵커·URL 조각·HTML 문자 참조·SVG 조각 참조(href="#add" · "/docs#fed" · "&#123;" · fill="url(#abc)")에도
#    나온다. 색이 아니니 넘긴다.
#    #RGBA(4자리)는 보지 않는다. 주석의 이슈 번호(#1234)와 구별할 수 없어 오탐만 늘어난다.
# 2. 기본 팔레트 클래스(웹만): bg-red-500 · text-white · hover:bg-black/50 …
#    생성된 globals.css 가 `--color-*: initial` 로 기본 팔레트를 지워 두어서, 이런 클래스는
#    오류 없이 아무 색도 안 나온다(조용한 실패). 앱은 Tailwind 를 쓰지 않으므로 보지 않는다.
#    tokens.json 에 같은 이름의 색(white 등)을 두었다면 그건 토큰 클래스이니 막지 않는다.
#
# 대상: web/·mobile/ 아래 .ts .tsx .js .jsx .mjs .css 전부. 새 폴더(web/features 등)도 등록 없이 본다.
# 예외: 빌드·의존성 폴더, 생성물(tokens --check 가 따로 본다), 프로젝트 바로 아래 도구 설정(*.config.*),
#       시험 파일(*.test.* · *.spec.* · e2e/ — 기대값으로 색을 적을 수 있다).
#
# macOS(BSD)·Ubuntu(GNU) 의 grep·sed·find 가 같은 결과를 내도록 POSIX 확장 정규식만 쓴다(grep -P·\b 를 쓰지 않는다).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 바이트 단위로 비교한다. 지역 설정에 따라 [[:alnum:]] 범위나 한글(잘못된 바이트) 처리가 달라지지 않게.
export LC_ALL=C

# grep 은 못 찾으면 1, 정규식·파일 오류면 2 로 끝난다. 2 까지 '못 찾음'으로 삼키면
# 검사가 조용히 초록불이 되므로 1 만 봐준다.
grep_or_none() { grep "$@" || [ "$?" -eq 1 ]; }

# ── 검사 대상 파일 ──
# 의존성·도구 산출물 폴더(node_modules · .next · .expo · .vercel · e2e · playwright-report · test-results)는 어느 깊이든 뺀다.
# 빌드 결과 폴더(out · dist · build · coverage)는 프로젝트 바로 아래 것만 뺀다 — web/app/coverage/ 같은 경로 폴더는 화면 코드다.
# 도구 설정도 프로젝트 바로 아래 것만 뺀다 — web/lib/theme.config.ts 처럼 안쪽의 *.config.* 는 앱 코드라서 색이 숨어들 수 있다.
list_sources() {
  find "$1" \
    \( -type d \( -name node_modules -o -name .next -o -name .expo -o -name .vercel -o -name e2e \
         -o -name playwright-report -o -name test-results \
         -o -path "$1/out" -o -path "$1/dist" -o -path "$1/build" -o -path "$1/coverage" \) -prune \) \
    -o \( -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.mjs' -o -name '*.css' \) \
         ! -name '*.test.*' ! -name '*.spec.*' \
         ! \( -name '*.config.*' ! -path "$1/*/*" \) \
         ! -path web/app/globals.css ! -path mobile/theme/tokens.ts \
         ! -path web/lib/database.types.ts ! -path mobile/lib/database.types.ts \
         -print \)
}

# 파일 이름에 공백·한글이 있어도 한 줄에 하나씩 그대로 받는다(줄바꿈이 든 이름은 다루지 않는다).
# find 결과를 변수에 먼저 받는 이유: find 가 실패하면 set -e 로 멈춘다. 일부만 보고 초록불을 띄우지 않는다.
# 정렬하는 이유: BSD·GNU find 는 폴더를 읽는 순서가 달라서, 정렬하지 않으면 실패 목록 순서가 OS 마다 다르다.
ALL_FILES=()
WEB_FILES=()
for project in web mobile; do
  [ -d "$project" ] || continue
  sources=$(list_sources "$project" | sort)
  while IFS= read -r file; do
    [ -n "$file" ] || continue
    ALL_FILES+=("$file")
    if [ "$project" = web ]; then WEB_FILES+=("$file"); fi
  done <<EOF
$sources
EOF
done
if [ "${#ALL_FILES[@]}" -eq 0 ]; then
  echo "✓ 검사할 화면 코드 없음"
  exit 0
fi

# ── 1. 직접 적은 색 ──
# '#' 앞이 영숫자·/·&·. 같은 글자면 URL 조각("/docs#fed")이나 문자 참조("&#123;")다.
# 뒤에 영숫자·- 가 이어지면 색이 아니다("#add-item"). _ 는 Tailwind 임의값의 띄어쓰기라 경계로 본다.
HEX_RE='(^|[^[:alnum:]/&.?=%~#-])#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})([^[:alnum:]-]|$)'
FUNC_RE='(^|[^[:alnum:]])(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\('
SPACE_RE='(^|[^[:alnum:]])color\((srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65)([^[:alnum:]-]|$)'
COLOR_RE="$HEX_RE|$FUNC_RE|$SPACE_RE"

# 링크 속성에 넣은 앵커(href="#add" · to="#bad" · href={`#add`} · { href: "#add" } · location.hash = "#fed")와
# SVG 조각 참조(fill="url(#abc)" · mask: url('#fade') — 그라디언트·마스크 같은 요소의 id 를 가리킨다)는
# '#' 을 잠시 \001 로 바꿔 색 정규식에 안 걸리게 한 뒤, 보여 줄 때 되돌린다. 같은 줄의 진짜 색은 그대로 걸린다.
# (router.push("#add") 처럼 앵커만 문자열로 넘기면 색과 구별할 수 없다. "/경로#add" 로 적으면 통과한다.)
QUOTE="[\"'\`]"
ANCHOR_RE="(^|[^[:alnum:]_\$])(href|xlinkHref|to|hash)([[:space:]]*[:=][[:space:]]*[{]?[[:space:]]*${QUOTE})#"
URL_REF_RE="(^|[^[:alnum:]_-])(url[(][[:space:]]*${QUOTE}?)#"
PLACEHOLDER=$'\001'

candidates=$(grep_or_none -nHIE -e "$COLOR_RE" -- "${ALL_FILES[@]}")
color_hits=""
if [ -n "$candidates" ]; then
  neutral=$(printf '%s\n' "$candidates" | sed -E "s/${ANCHOR_RE}/\\1\\2\\3${PLACEHOLDER}/g; s/${URL_REF_RE}/\\1\\2${PLACEHOLDER}/g")
  color_hits=$(printf '%s\n' "$neutral" | grep_or_none -E -e "$COLOR_RE" | tr '\001' '#')
fi

# ── 2. Tailwind 기본 팔레트 클래스 (웹만) ──
# 색을 받는 유틸리티 × 기본 팔레트 이름. 변형 접두(hover: · md: · dark:)와 투명도 접미(/50 · /[0.5]),
# 중요 표시(!)가 붙어도 잡는다. 앞뒤가 영숫자·_·-·. 등으로 이어지면 다른 단어의 일부("nav-bg-white" · "bg-black.png")다.
# text-sm · border-2 · ring-offset-2 같은 비색 유틸리티와 bg-transparent · bg-current 는 팔레트 이름이 아니라서 걸리지 않는다.
HUES="slate gray zinc neutral stone red orange amber yellow lime green emerald teal cyan sky blue indigo violet purple fuchsia pink rose"
SHADES="50 100 200 300 400 500 600 700 800 900 950"
UTILITIES='bg|text|border|border-[xytrblse]|ring|ring-offset|outline|fill|stroke|from|via|to|shadow|inset-shadow|inset-ring|drop-shadow|text-shadow|divide|placeholder|caret|accent|decoration'

# tokens.json 의 colors 에 같은 이름으로 둔 색(예: "white")은 globals.css 가 다시 만들어 주는 토큰 클래스다.
# colors 의 키만 본다. tokens-gen 이 --color-* 로 만드는 것은 colors 뿐이라, fonts·nativeFonts 같은 다른
# 키 이름이 우연히 "white" 여도 bg-white 는 여전히 무색이다.
TOKEN_NAMES=" "
if [ -f design/tokens.json ]; then
  TOKEN_NAMES=" $(node -e 'const t = JSON.parse(require("fs").readFileSync("design/tokens.json", "utf8")); process.stdout.write(Object.keys(t.colors ?? {}).join(" "))') "
fi
PALETTE_NAMES=""
for name in white black $(for hue in $HUES; do for shade in $SHADES; do echo "$hue-$shade"; done; done); do
  case "$TOKEN_NAMES" in
    *" $name "*) ;;
    *) PALETTE_NAMES="$PALETTE_NAMES|$name" ;;
  esac
done
PALETTE_NAMES="${PALETTE_NAMES#|}"
PALETTE_RE="(^|[^[:alnum:]_./@#\$-])(${UTILITIES})-(${PALETTE_NAMES})([^[:alnum:]_.-]|\$)"

palette_hits=""
if [ "${#WEB_FILES[@]}" -gt 0 ] && [ -n "$PALETTE_NAMES" ]; then
  palette_hits=$(grep_or_none -nHIE -e "$PALETTE_RE" -- "${WEB_FILES[@]}")
fi

# ── 결과 ──
if [ -n "$palette_hits" ]; then
  echo "❌ Tailwind 기본 팔레트 클래스가 있습니다. 생성된 web/app/globals.css 가 기본 팔레트를 지워 두어서(--color-*: initial)" >&2
  echo "   이 클래스들은 오류 없이 아무 색도 안 나옵니다:" >&2
  echo "$palette_hits" >&2
  echo "" >&2
  echo "   토큰 클래스로 바꾸세요. 예: bg-black/10 → bg-foreground/10, text-white → text-primary-foreground, bg-red-500 → bg-destructive" >&2
  echo "" >&2
fi
if [ -n "$color_hits" ]; then
  echo "❌ 화면 코드에 색이 직접 적혀 있습니다. 여기 적은 색은 design/tokens.json 을 고쳐도 따라오지 않습니다:" >&2
  echo "$color_hits" >&2
  echo "" >&2
  echo "   웹: 토큰 클래스(bg-primary) 또는 var(--이름)   앱: colors.이름 (mobile/theme/tokens.ts)" >&2
  echo "   색이 아니라 앵커라면 href=\"#이름\" 이나 \"/경로#이름\" 처럼 링크로, SVG 요소 참조라면 url(#이름) 으로 적으세요." >&2
  echo "" >&2
fi
if [ -n "$palette_hits$color_hits" ]; then
  echo "   새 색이 필요하면 design/tokens.json 에 추가하고 pnpm tokens 를 돌리세요." >&2
  exit 1
fi
echo "✓ 하드코딩된 색·기본 팔레트 클래스 없음 — design/tokens.json 토큰만 사용"
