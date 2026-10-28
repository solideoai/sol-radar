# 테두리 상자 모서리 하나로 맞추기 (2026-10-28)

design.actibooky.com DESIGN_RULES 대조 뒤 사용자 결정: 본문 글자는 14px 그대로 두고(정본 "조밀하게"), 모서리만 맞춘다. `Card` 도 포함한다.

## 바꾼 것

- `web/components/ui/card.tsx`: `rounded-xl`·`rounded-t-xl`·`rounded-b-xl` → `-lg`
- 화면에서 직접 만든 테두리 상자 17곳 `rounded-xl` → `rounded-lg`(빈 상태·필터 칸·로딩 뼈대·변경 이력 목록·입찰 프로젝트·수집 관리 표·랜딩 화면 조각)
- 랜딩 분석 예시 탭 `rounded-[10px]` → `rounded-lg`
- 규칙: [[06-UI-UX|06 UI/UX]] §3.3 "모서리" 줄, `.claude/skills/design-system/SKILL.md`
- 대화상자(`dialog`)·메뉴·사이드바 부품은 그대로다

## 화면 확인

격리 로컬 Supabase(`sol-radar-r1028`, 포트 59821) + `pnpm db:seed` + `next dev`(3497), `seed-owner` 로그인. Playwright 로 11개 경로를 1440·1280px 에서 열고, 본문 안 테두리 상자(가로 120px·세로 48px 이상)의 계산된 모서리를 셌다([results.json](results.json)).

| 경로 | 상자 모서리 | 가로 넘침(1440·1280) |
|---|---|---|
| `/` | 8px 11개 | 0·0 |
| `/dashboard` | 8px 1개 | 0·0 |
| `/bids` | 8px 2개 | 0·0 |
| `/watchlist` | 8px 2개 | 0·0 |
| `/projects` | 8px 5개 | 0·0 |
| `/notifications` | 8px 1개 | 0·0 |
| `/company` | 8px 1개(Card 1) | 0·0 |
| `/settings/organization` | 8px 5개(Card 5) | 0·0 |
| `/admin/ingestion` | 8px 3개 | 0·0 |
| `/seed-team/dashboard` | 8px 7개(Card 7) | 0·0 |
| `/seed-team/settings/members` | 8px 4개(Card 4) | 0·0 |

8px 밖의 모서리를 가진 상자는 0개다. 시드에 공고·분석 결과가 없어 공고 상세(판단 패널 `Card`)는 열지 못했다.
