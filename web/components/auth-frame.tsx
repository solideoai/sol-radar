// 본문 랜드마크(main#main-content)는 이 틀이 그린다. 루트 layout 의 건너뛰기 링크가 여기로 온다.
// 세로 가운데는 안쪽 단의 my-auto 로 맞춘다 — justify-center 는 내용이 화면보다 길 때 윗부분을 화면 밖으로 밀어 닿을 수 없게 한다.
export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex flex-1 flex-col px-4 py-10 outline-none sm:py-16"
    >
      <div className="mx-auto my-auto flex w-full max-w-100 flex-col gap-6">{children}</div>
    </main>
  );
}

// note(404·오류 번호)는 긴 번호가 단을 넘기지 않게 끊는다.
// text-balance: 가운데 정렬한 설명이 좁은 폭에서 마지막 줄에 한 낱말만 남기지 않게 한다.
export function AuthHeader({
  title,
  note,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 text-center text-balance">
      <h1 className="type-title text-foreground">{title}</h1>
      {children ? <p className="type-body text-muted-foreground">{children}</p> : null}
      {note ? <p className="type-caption wrap-anywhere text-muted-foreground">{note}</p> : null}
    </div>
  );
}
