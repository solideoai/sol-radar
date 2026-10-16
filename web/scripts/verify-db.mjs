// Vercel이 web 의존성만 설치해도 드라이버를 찾도록 웹 패키지에서 제공한다.
import pg from "pg";
import { describeFailure, runDbVerification } from "../../scripts/db-verify.mjs";

// 빌드 로그에도 pnpm db:verify 와 같은 안내만 찍는다. 외부 오류 원문(접속 주소·비밀값이 섞일 수 있음)은
// 옮기지 않고, 목록에 있는 오류 코드(42501 권한 없음·28P01 인증 실패 등)만 보여 준다.
try {
  await runDbVerification(pg.Client);
} catch (error) {
  console.error(describeFailure(error));
  process.exitCode = 1;
}
