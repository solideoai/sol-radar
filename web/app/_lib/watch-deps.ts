import "server-only";
import { watchlistRepo, type WatchlistRepo } from "@/server/watchlist";

// 관심 공고(N3) Route Handler 가 서비스에 주입하는 저장. 시험은 이 모듈을 가짜로 바꾼다(work-deps 와 같은 자리).
export function watchDeps(): { repo: WatchlistRepo } {
  return { repo: watchlistRepo };
}
