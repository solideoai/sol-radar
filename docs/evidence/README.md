---
title: "증거 폴더 안내"
doc: "evidence-readme"
status: final
tags:
  - sol-radar
  - test
  - hackathon
updated: 2026-10-27
---

# 증거 폴더 안내

이 폴더는 "어떻게 검증했나"에 파일로 답하는 기록을 둔다. 테스트 출력, 기동 로그, 화면 스크린샷, 운영 적용 기록이 들어간다. 통과·실패 판정과 숫자는 각 파일 안에 있고, 이 안내는 폴더별 목록을 두지 않는다. 폴더는 `ls docs/evidence`로 본다.

## 구성

- 작업 단위 폴더 아래에 둔다(`phase-N/`, `deployment/`, `demo-deadline/` 등). 날짜가 있는 기록은 `YYYYMMDD` 하위 폴더를 쓴다.
- 폴더마다 `README.md`가 있으면 그 폴더가 증명하는 것과 읽는 순서를 거기 적는다.
- 주장과 증거 파일의 대응은 [[11-TESTING|11 테스트]] §6, 제출용 AI 검증 증거는 `docs/submission/evidence-list.md`가 맡는다.

## 규칙

- 테스트 출력은 명령 전체 stdout을 그대로 저장한다. 첫 줄에 실행 명령과 커밋 해시 또는 날짜를 적는다.
- 스크린샷 파일 이름은 `YYYYMMDD-phaseN-<route>-<state>-<width>.png`다([[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]]). `width`는 1440·1280이다.
- 실패한 실행도 저장하고 파일 이름 끝에 `-FAIL`을 붙인다. 이후 통과하면 둘 다 남긴다.
- 통과하지 못한 항목은 통과한 것처럼 쓰지 않는다. 실행하지 않은 것은 "미확인"으로 적는다.
- 비밀값·토큰·서비스키가 든 요청 URL, 실제 RFP 원문, 공공 API 응답의 담당자 개인정보는 두지 않는다. 로그는 저장 전에 마스킹한다([[09-SECURITY|09 보안]]).
- 증거 파일은 이력이다. 다른 문서가 이 폴더의 파일을 링크할 때는 파일 이름이 바뀌지 않게 둔다.

## 관련 문서

- [[11-TESTING|11 테스트]] — 증거 산출물 규칙
- [[17-CLAUDE-IMPLEMENTATION|17 구현 규칙]] — 스크린샷 파일 이름 규칙
- [[PROGRESS|진행 상황]]
