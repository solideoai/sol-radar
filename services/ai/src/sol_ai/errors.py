"""기동 거부 예외. python -m sol_ai 가 잡아 exit 78(EX_CONFIG)로 끝낸다."""


class StartupRefused(Exception):
    """설정 위반. summary 에는 "키(사유)" 만 담는다. 값(해시·경로·비밀)은 담지 않는다."""

    def __init__(self, summary: str) -> None:
        super().__init__(summary)
        self.summary = summary
