import { cn } from "cn";
import {
  BotIcon,
  LockKeyholeIcon,
  MonitorSmartphoneIcon,
  PaletteIcon,
  ShieldCheckIcon,
  WorkflowIcon,
} from "lucide-react";
import Link from "next/link";
import { DashboardPreview } from "@/components/dashboard-preview";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

// 로그인 상태를 읽지 않는 화면이다. 그래도 요청마다 그린다 — CSP nonce 때문에 루트 layout 이 모든 화면을 동적 렌더링으로 둔다.
export default function Home() {
  return (
    <>
      <SiteHeader />
      {/* 루트 layout 의 건너뛰기 링크가 여기로 온다. 머리말을 지나 본문부터 Tab 이 이어진다. */}
      {/* 바탕(muted 의 절반) 위에서 흰 카드가 드러난다. 구역 사이는 선 없이 여백으로만 나눈다. */}
      <main id="main-content" tabIndex={-1} className="flex-1 bg-muted/50 outline-none">
        <Hero />
        <Features />
        <Start />
      </main>
      <SiteFooter />
    </>
  );
}

function Hero() {
  return (
    <section className="px-4 py-16 sm:px-6 md:py-24">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center">
        <div className="flex max-w-3xl flex-col items-center text-center">
          <h1 className="type-headline text-balance text-foreground md:type-display">
            가드레일이 깔린 채로 시작하는 AI 코딩
          </h1>
          <p className="mt-5 max-w-2xl type-lead text-balance text-muted-foreground">
            똑똑한 프롬프트가 아니라 <strong>가드레일</strong>이 결과물을 지킵니다. 만들고 싶은 걸
            말하면,{" "}
            {/* 가운뎃점 앞뒤에서 줄이 바뀌면 다음 줄이 점으로 시작한다. 한 덩어리로 묶는다. */}
            <span className="whitespace-nowrap">검증·구조·배포는</span> 이 환경이 잡아줍니다.
          </p>
          {/* 주요 버튼(default)은 시작하기 하나다. 로그인은 테두리 버튼으로 낮춘다. */}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/auth/sign-up" className={buttonVariants({ size: "lg" })}>
              시작하기
            </Link>
            {/* buttonVariants 는 클래스를 이어 붙이기만 한다. cn 으로 합쳐야 outline 의 테두리가 바탕의 투명 테두리를 이긴다. */}
            <Link
              href="/auth/login"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
            >
              로그인
            </Link>
          </div>
        </div>
        {/* 견본 화면은 그림이라 화면 낭독기에서 숨겨져 있다. 무엇을 그린 것인지는 아래 글이 알린다. */}
        <figure className="mt-12 w-full md:mt-16">
          <DashboardPreview />
          <figcaption className="mt-3 text-center type-caption text-balance text-muted-foreground">
            로그인 뒤에 보는 대시보드의 모습입니다. 숫자와 날짜는 견본 데이터입니다.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}

// 기능 칸. 이 저장소에 실제로 있는 장치만 적는다 — 근거는 AGENTS.md 와 docs/boilerplate/guardrails.md 다.
// 장치를 빼거나 바꾸면 여기 글도 같이 고친다.
const FEATURES = [
  {
    icon: ShieldCheckIcon,
    title: "검증 게이트",
    body: (
      <>
        <Code>/verify</Code> 가 서식·타입·린트·테스트·구조·토큰·색·빌드를 한 번에 검사합니다. 커밋할
        때는 바뀐 폴더만 골라 빌드를 뺀 검사를 다시 돌리고, 통과하지 못하면 커밋을 막습니다.
      </>
    ),
  },
  {
    icon: LockKeyholeIcon,
    title: "RLS 로 잠긴 DB",
    body: (
      <>
        표는 만들자마자 잠그고, 필요한 권한과 정책으로만 엽니다. 누가 무엇을 읽고 쓰는지는 Supabase
        의 RLS 정책이 정하고, 정책은 실제 DB 없이 PGlite 로 시험합니다.
      </>
    ),
  },
  {
    icon: PaletteIcon,
    title: "토큰 정본 하나",
    body: (
      <>
        색·글꼴·글자 눈금은 <Code>design/tokens.json</Code> 한 곳에만 적습니다. 웹의 CSS 와 앱의
        theme 가 거기서 만들어지고, 화면 코드에 색을 직접 적으면 커밋 게이트와 CI 가 막습니다.
      </>
    ),
  },
  {
    icon: MonitorSmartphoneIcon,
    title: "웹과 앱이 한 저장소",
    body: (
      <>
        Next.js 웹과 Expo 앱이 한 저장소에 있고, 각자 설치되고 실행됩니다. 둘이 같이 쓰는 것은 DB
        스키마와 디자인 토큰뿐이라, 한쪽만 쓰면 다른 폴더를 지우면 됩니다.
      </>
    ),
  },
  {
    icon: BotIcon,
    title: "스킬과 에이전트",
    body: (
      <>
        코드 규칙·구조·DB·디자인·테스트 기준이 스킬로 들어 있어, 클로드가 작업 전에 읽습니다. 구현과
        검증은 서로 다른 에이전트가 맡습니다.
      </>
    ),
  },
  {
    icon: WorkflowIcon,
    title: "CI",
    body: (
      <>
        PR 과 <Code>main</Code> push 마다 GitHub Actions 가 공통 검사, 프로젝트별 검증, 웹 E2E,
        의존성 감사를 돌립니다. 커밋 메시지 형식도 같은 규칙으로 다시 확인합니다.
      </>
    ),
  },
];

function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className="px-4 py-16 sm:px-6 md:py-24">
      <div className="mx-auto w-full max-w-6xl">
        <div className="max-w-2xl">
          <h2 id="features-title" className="type-title text-foreground md:type-headline">
            처음부터 깔려 있는 가드레일
          </h2>
          <p className="mt-3 type-lead text-muted-foreground">
            확인을 사람의 기억에 맡기지 않습니다. 아래 장치는 모두 이 저장소에 들어 있습니다.
          </p>
        </div>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.title}>
              <Card className="h-full">
                <CardContent className="flex flex-col gap-3">
                  <span
                    aria-hidden
                    className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted text-foreground"
                  >
                    <feature.icon className="size-4" />
                  </span>
                  <h3 className="type-heading text-foreground">{feature.title}</h3>
                  <p className="type-body text-muted-foreground">{feature.body}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const STEPS = [
  { cmd: "/setup", desc: "환경 확인 + 사용법 소개 (처음 한 번)" },
  { cmd: "/verify", desc: "타입·린트·테스트·구조·토큰·색·빌드를 검사한다 (단계마다)" },
  { cmd: "/predeploy-review", desc: "배포 전 전문가 관점으로 점검한다" },
];

function Start() {
  return (
    <section id="start" aria-labelledby="start-title" className="px-4 py-16 sm:px-6 md:py-24">
      <div className="mx-auto grid w-full max-w-6xl gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 id="start-title" className="type-title text-foreground md:type-headline">
            세 단계로 시작합니다
          </h2>
          <p className="mt-3 type-lead text-muted-foreground">
            클로드를 열고 <Code>/setup</Code> 을 실행하세요.
          </p>
          <div className="mt-6 flex flex-col gap-2 type-body text-muted-foreground">
            <p>
              이 페이지는 출발점입니다. <Code>/setup</Code> 으로 시작한 뒤, 이 화면부터 당신의
              것으로 바꿔 나가세요. 언제든 <Code>/help</Code> 로 도움을 받을 수 있습니다.
            </p>
            <p>
              새 기능은{" "}
              <Link
                href="/auth/login"
                className="rounded-sm font-medium text-primary underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                로그인 견본
              </Link>
              처럼 짓습니다 — 로그인 → 본인 프로필 읽기 → 로그아웃.
            </p>
          </div>
        </div>
        {/* 카드의 위아래 여백은 줄마다의 여백이 대신한다. */}
        <Card className="self-start py-0">
          <ol className="divide-y divide-border">
            {STEPS.map((step, index) => (
              <li key={step.cmd} className="flex gap-4 px-6 py-5 type-body">
                <span className="text-muted-foreground tabular-nums">{index + 1}</span>
                {/* min-w-0 이 없으면 긴 명령이 줄을 밀어 좁은 폭에서 가로로 넘친다. */}
                <div className="min-w-0">
                  <code className="font-mono font-semibold wrap-anywhere text-foreground">
                    {step.cmd}
                  </code>
                  <p className="mt-1 type-label text-muted-foreground">{step.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </section>
  );
}

// break-keep 때문에 긴 경로가 꺾이지 않아 좁은 칸을 넘는다. wrap-anywhere 로 꺾는다.
function Code({ children }: { children: React.ReactNode }) {
  return <code className="font-mono wrap-anywhere">{children}</code>;
}
