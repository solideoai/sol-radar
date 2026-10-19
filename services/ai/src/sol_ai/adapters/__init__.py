"""모델 어댑터. 모드 분기(AI_PROVIDER)는 factory.build_adapters 한 곳에만 있다.

- base: 어댑터 계약과 실패 예외
- mock: fixture 고정 응답(Qwen 추출·Kev), AI_FAULT_INJECT 흉내
- unavailable: 아직 없는 공급자(local·hosted). 조용히 mock 으로 바꾸지 않고 "모델 미접속"으로 끝낸다
- kev: Kev 어댑터(영어 state → wire 요청 → KevAssist)
- kev_wire: Kev wire 필드명. 이 모듈 밖에서 wire 필드명을 쓰지 않는다
"""
