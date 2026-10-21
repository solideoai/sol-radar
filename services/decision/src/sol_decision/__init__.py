"""SOL RADAR 결정 모델 서버(sol_decision).

Bosun v3.1 0.6B 를 Kev wire 호환 HTTP(`POST /v1/systemone`·`GET /v1/models`·`GET /health`)로 서빙한다
(docs/03 §5.3·§5.4, docs/16 ADR-034 3번). 코어 모듈(wire·contract·app·package·settings)은 torch·transformers 를
import 하지 않는다. 모델 의존 코드는 backend.BosunBackend 안에서만 지연 import 한다.
"""

__version__ = "0.1.0"
