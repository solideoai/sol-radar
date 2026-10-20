"""Bosun v3.1 0.6B LoRA 이어 학습기의 부품(docs/22 §4, ADR-034 7번).

- 순수 모듈(torch 없이 import 가능): `data`·`prompting`·`metrics`·`checkpoint`·`calibrate`
- torch 모듈: `loss`·`params`

진입점은 `python -m sol_decision.train`(학습)·`python -m sol_decision.parity`(동일성 검사)·
`python -m sol_decision.trainer.calibrate`(온도 보정)이다. 이 패키지는 서빙 코드(`serve.py` 등)를 import 하지 않는다.
"""
