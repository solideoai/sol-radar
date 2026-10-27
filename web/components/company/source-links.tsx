import { ExternalLinkIcon } from "lucide-react";
import type { ProfileSource } from "@/server/company-profile";

// 항목 옆에 붙이는 출처 링크 목록. sourceIds 가 비었거나 맞는 출처가 없으면 아무것도 그리지 않는다.
// 회사가 직접 확인한 출처(COMPANY_CONFIRMED)는 "회사 확인"으로 공개 자료와 구분한다.

export const CONFIRMED_LABEL = "회사 확인";

export function SourceLinks({
  sourceIds,
  sources,
}: {
  sourceIds: string[] | undefined;
  sources: ProfileSource[];
}) {
  const matched = (sourceIds ?? [])
    .map((id) => sources.find((source) => source.id === id))
    .filter((source) => source !== undefined);
  if (matched.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {matched.map((source) => (
        <li key={source.id} className="inline-flex items-center gap-1 type-caption">
          {source.kind === "COMPANY_CONFIRMED" ? (
            <span className="text-foreground">{CONFIRMED_LABEL}</span>
          ) : null}
          {source.url === null ? (
            <span className="text-muted-foreground">{source.title}</span>
          ) : (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {source.title}
              <ExternalLinkIcon aria-hidden="true" className="size-3 shrink-0" />
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}
