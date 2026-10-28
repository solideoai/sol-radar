"use client";

import { WorkError } from "@/app/(app)/(work)/work-error";
import { MARKET_TITLE } from "./market-copy";

export default function MarketError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry(): void;
}) {
  return (
    <WorkError error={error} retry={retry} title={MARKET_TITLE} contentClassName="max-w-360" />
  );
}
