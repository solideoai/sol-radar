import { z } from "zod";

// 앱이 동작하기 전에 브라우저에서 한 번 돈다(web/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md).
// zod 는 처음 검사할 때 new Function("") 으로 eval 이 되는지 시험한다. 오류는 삼키지만 CSP(eval 금지)가 그 시도를
// 위반으로 보고한다. jitless 면 그 시험을 건너뛴다(node_modules/zod/v4/core/util.js 의 allowsEval). 서버는 CSP 밖이라 그대로 둔다.
z.config({ jitless: true });
