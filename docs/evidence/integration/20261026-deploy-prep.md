---
title: "10-26 ③ 배포 준비(원격 main 병합·재검증·Vercel 사전 확인)"
status: done
tags: [sol-radar, evidence, integration, deploy]
updated: 2026-10-26
---

# 10-26 ③ 배포 준비

근거: [[20261025-release-runbook|10-25 릴리스 실행서]] §5. 2026-10-26 사용자 승인 범위는 로컬 준비까지다. push·Vercel 배포·운영 DB/Storage/env/컨테이너 변경은 하지 않았다.

> [!summary] 결론
> - `integration/release-1025` 에 origin/main(dependabot 2커밋)을 병합했다(`9e1d89fc`). 충돌 0, 바뀐 파일 3개.
> - 같은 커밋에서 전체 `pnpm verify` exit 0, 브라우저 시험 60/60, 격리 E2E 18/18, 핵심 화면 1440·1280 확인.
> - GitHub Actions 는 계정 결제 문제로 job 이 시작되지 않는다. ③ push 의 CI 도 돌지 않을 것이라 로컬 검증과 `pre-push` 게이트로 대신한다.
> - Vercel CLI 가 없어 Production Branch·Instant Rollback 은 대시보드에서 사람이 확인해야 한다.

## 원격 main 병합

- `git fetch origin`: origin/main `1bcaef7d`. 10-25 확인 뒤 새 원격 커밋 없음.
- 병합: `git merge --no-ff origin/main` → `9e1d89fc chore: 원격 main dependabot 2건 병합`.
  - `e9fbf349` ci: anthropics/claude-code-action 갱신(`.github/workflows/claude-review.yml`)
  - `1bcaef7d` build: web 의존성 9개(`web/package.json`·`web/pnpm-lock.yaml`)
- `pnpm -C web install --frozen-lockfile` exit 0, 락파일 그대로.

| 패키지 | 전 | 후 |
|---|---|---|
| next | 16.4.1 | 16.4.2 |
| eslint-config-next | 16.4.1 | 16.4.2 |
| vitest | 4.1.11 | 4.1.12 |
| bullmq | 6.3.16 | 6.3.17 |
| nodemailer | 10.1.1 | 10.1.7 |
| lucide-react | 1.57.0 | 1.60.0 |
| shadcn | 4.21.5 | 4.22.1 |
| @hookform/resolvers | 5.9.1 | 5.9.2 |
| cn | 0.4.0 | 0.5.0 |

## 검증(코드 `9e1d89fc`)

- 전체 `pnpm verify`(release worktree, 슬롯, 2026-10-26 09:13:41–09:16:28) exit 0. 원문 `20261026-deploy-prep/verify-9e1d89fc.txt`.
  - 루트 node 시험 229/229, web 593/593(72파일), 구조(lodestar) 2규칙 0오류, 빌드 통과(정적 59), AI 153, decision 57
  - 디자인 토큰·색·DB 타입·린트 가드레일 일치
- `pnpm -C web test:browser` 60/60(7파일). 원문 `20261026-deploy-prep/test-browser-9e1d89fc.txt`.
- 격리 E2E 8차. 원문 `20261026-deploy-prep/e2e-8-9e1d89fc.txt`.
  - 코드: 새 worktree `sol-radar-worktrees/e2e-rh1026`(detached `9e1d89fc`, frozen install). a2 의 `e2e-rh1025` 는 건드리지 않았다.
  - DB·Compose: 격리 스택 rh1025 그대로([[20261025-e2e/stack|스택]], migration 60개). worker 이미지는 7f1cbeca 빌드 그대로 두었다. ③ 은 web 만 배포하고 회사 worker 는 바꾸지 않으므로 "새 web + 기존 worker" 가 운영과 같은 조합이다.
  - `pnpm -C web build`(Next.js 16.4.2) exit 0 → `pnpm -C web test:e2e:work` **18 passed (1.4m)**(09:16:01–09:17:29). FX-02 72·FX-01 94·분석 비교·가정 재계산 FX-03·프로필 사진(가입 신청→사진→승인→조직도) 포함.
- 화면 직접 확인(같은 빌드 `next start` localhost:3210, E2E 로그인 상태 재사용):

| 화면 | 1440 | 1280 | 비고 |
|---|---|---|---|
| `/dashboard` | 200 | 200 | 가로 넘침 없음·페이지 오류 0. mock 이라 기본 출처가 DEMO 여서 `?origin=demo` 와 같다 |
| `/dashboard?origin=demo` | 200 | 200 | 위와 같음 |
| `/admin/ingestion`(SALES·ANALYST) | 200 | 200 | "이 화면을 볼 권한이 없습니다 … ADMIN인 구성원만" 안내 |
| 공고 목록(E2E) | 확인 | — | DEMO 배지·툴팁 |
| 공고 상세 org-02 VIEWER(E2E) | — | 확인 | 분석 없음·결정 입력 권한 안내 |
| 설정 › 조직 가입 신청(E2E) | — | 확인 | 신청자 사진·승인/거절 |

  - 미확인: ADMIN 으로 본 `/admin/ingestion` 내용(이번 회차에 ADMIN 로그인 상태가 없었다).
  - 스크린샷: `20261026-deploy-prep/*.png`(8장).

## Vercel 사전 확인(읽기 전용)

- Vercel CLI 미설치, 저장소에 프로젝트 연결 파일 없음. Production Branch·플랜·Instant Rollback 가능 여부를 CLI 로 확인하지 못했다.
- GitHub 커밋 상태의 Vercel 배포 기록(main push 마다 1건):

| 커밋 | 배포 완료(KST) | 배포 ID |
|---|---|---|
| `4e84e084` | 2026-10-24 11:09 | `ACh4EMeL8N3oEvrZybQwUz8C9E2w` |
| `e9fbf349` | 2026-10-25 17:20 | `8mdTBmEUzWSJtwTKREmw87AJ9gt3` |
| `1bcaef7d` | 2026-10-25 17:21 | `25wuet7CSWPNJiR2PY8zCYD2RYiy` |

- 지금 운영은 마지막 main 배포인 `1bcaef7d` 로 본다(대시보드에서 Production 표시 확인 필요). next 16.4.2 는 이미 운영에서 돈다.
- 2026-10-26 오전 `https://www.solideos-radar.com/health/live` 200, `/health/ready` 200(`db`·`redis`·`storage` ok, `ai: local`).
- 운영 `1bcaef7d` → 배포 예정 커밋: 33커밋(병합 포함), 284파일. web/app 44·web/server 40·web/components 18·web/worker 6·web/lib 3·supabase 10(①에서 적용 끝)·scripts 11·infra 3·docs 144. 배포 예정 커밋은 이 문서를 담은 docs 커밋이고 코드는 `9e1d89fc` 와 같다.
- GitHub Actions: `e9fbf349`·`1bcaef7d` 의 ci job 이 "The job was not started because recent account payments have failed or your spending limit needs to be increased" 로 시작되지 않았다(`4e84e084` 는 통과). 코드 문제가 아니다.

## ③ 실행 명령(승인 뒤)

```bash
git -C /Users/leegwanghui/dev/hackathon/sol-radar status --short      # web/public/naver-login-button.png 하나만 있어야 한다
git -C /Users/leegwanghui/dev/hackathon/sol-radar log -1 --format=%H  # 보고한 배포 커밋과 같아야 한다
git -C /Users/leegwanghui/dev/hackathon/sol-radar config gate.prePush true   # 선택(권장): CI 대신 push 전 깨끗한 checkout 검사
bash <verify-slot.sh> git -C /Users/leegwanghui/dev/hackathon/sol-radar push origin main
```

- 강제 push 를 쓰지 않는다. 로컬 main 이 origin/main 을 포함하므로 fast-forward push 다.
- push 하면 Vercel Git 연동이 운영 배포를 만든다.

## ③ 배포 뒤 확인 계획

1. Vercel 배포 Ready, 배포 커밋이 보고한 SHA 인지 본다.
2. `/health/live`·`/health/ready` 200(`db`·`redis`·`storage` ok).
3. 1440·1280 두 폭으로 본다: `/dashboard`·`/dashboard?origin=demo`·`/bids?origin=demo`·공고 상세 1건·`/admin/ingestion`(ADMIN)·`/settings`(계정 사진)·`/settings/organization`(가입 신청 표, ADMIN)·조직도.
4. 사진 1장 올리기·지우기(운영 Storage 쓰기, ③ 승인에 포함):
   - 사용자 본인 계정으로 로그인한다. 개인정보 없는 2MB 미만 JPEG 또는 PNG 1장을 쓴다.
   - `/settings` 계정 사진 올리기 → 사이드바·조직도에 보이는지 본다.
   - 같은 화면에서 사진 지우기 → 이니셜로 돌아오는지 본다.
   - 읽기 전용 Storage 검증을 다시 돌려 `profile-photos` 객체 0개, bid 두 버킷 그대로, PASS 8줄을 본다.
5. 실패하면 Vercel 대시보드에서 직전 운영 배포(`1bcaef7d`, `25wuet7CSWPNJiR2PY8zCYD2RYiy`)로 Instant Rollback 한다. DB·버킷은 그대로 둔다(새 객체는 지금 운영 웹이 부르지 않는다).

## 남은 위험

- CI 가 돌지 않는다. 깨끗한 checkout 검사는 `pre-push` 게이트를 켰을 때만 생긴다.
- Production Branch·플랜·Instant Rollback 은 사람이 대시보드에서 확인해야 한다. Hobby 플랜이면 바로 앞 운영 배포로만 되돌릴 수 있다.
- ADMIN 화면의 `/admin/ingestion` 은 이번 회차에 브라우저로 보지 않았다.
- 운영 사진 업로드는 배포 뒤 처음 실제로 해 본다.

## 관련 문서

- [[20261025-prod-apply-db-storage|①·② 운영 적용]]
- [[20261025-release-runbook|10-25 릴리스 실행서]]
- [[20261025-e2e/summary|10-25 격리 E2E 결과]]
- [[PROGRESS|진행 상황]]
