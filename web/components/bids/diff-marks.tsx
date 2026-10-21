import { cn } from "cn";

// 변경 이력의 추가·삭제 표시(스펙 §3.2). 색만으로 구분하지 않도록 밑줄·취소선과 화면 낭독 글자를 함께 쓴다.
const ADDED_CLASS = "font-semibold text-success underline decoration-2 underline-offset-4";
const REMOVED_CLASS = "text-destructive line-through decoration-2";

// 앞뒤 공백·줄바꿈은 표시 밖에 둔다(빈칸에 밑줄이 그어지지 않게). 글자는 바꾸지 않는다.
function splitEdges(text: string): [string, string, string] {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
  return match === null ? ["", text, ""] : [match[1] ?? "", match[2] ?? "", match[3] ?? ""];
}

// 삭제 바로 뒤에 공백 없이 오는 추가는 한 단어처럼 붙어 보이므로 앞에 틈을 둔다.
const AFTER_REMOVED_CLASS = "ms-1";

function Added({ text, afterRemoved = false }: { text: string; afterRemoved?: boolean }) {
  const [head, core, tail] = splitEdges(text);
  if (core === "") return <>{text}</>;
  return (
    <>
      {head}
      <ins className={cn(ADDED_CLASS, afterRemoved && head === "" && AFTER_REMOVED_CLASS)}>
        <span className="sr-only">추가됨 </span>
        {core}
        <span className="sr-only"> 추가 끝</span>
      </ins>
      {tail}
    </>
  );
}

function Removed({ text }: { text: string }) {
  const [head, core, tail] = splitEdges(text);
  if (core === "") return <>{text}</>;
  return (
    <>
      {head}
      <del className={REMOVED_CLASS}>
        <span className="sr-only">삭제됨 </span>
        {core}
        <span className="sr-only"> 삭제 끝</span>
      </del>
      {tail}
    </>
  );
}

// 표의 단일 값 칸. 열 머리(이전 rN·이후 rN)가 뜻을 주므로 낭독 글자는 붙이지 않는다.
function ValueMark({
  kind,
  className,
  children,
}: {
  kind: "added" | "removed";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn(kind === "added" ? ADDED_CLASS : REMOVED_CLASS, className)}>
      {children}
    </span>
  );
}

export { ADDED_CLASS, REMOVED_CLASS, Added, Removed, ValueMark };
