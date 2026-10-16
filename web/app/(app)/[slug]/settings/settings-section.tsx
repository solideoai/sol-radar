// 설정 화면(계정·팀)의 가는 선 구역. 단이 넓으면(@3xl) 왼쪽에 제목·설명, 오른쪽에 내용을 둔다.
// 디자인 시스템 부품이 아니라 설정 화면 전용이다.
export function SettingsSection({
  id,
  title,
  description,
  focusable = false,
  children,
}: {
  id: string;
  title: string;
  description: string;
  // 동작 뒤 초점을 돌려받는 제목이면 켠다(로그인 수단 — 누른 줄의 버튼이 사라질 수 있다).
  focusable?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="grid gap-x-10 gap-y-5 py-8 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
    >
      <div>
        <h2
          id={id}
          tabIndex={focusable ? -1 : undefined}
          className="type-heading text-foreground outline-none"
        >
          {title}
        </h2>
        <p className="mt-1 type-body text-muted-foreground">{description}</p>
      </div>
      {/* 입력칸이 단의 끝까지 늘어나지 않게 폭을 묶는다. */}
      <div className="flex w-full max-w-md flex-col gap-6">{children}</div>
    </section>
  );
}
