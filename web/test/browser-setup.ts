// 부품 레이아웃 시험(vitest.browser.config.ts)이 앱과 같은 CSS(토큰·Tailwind)로 그리도록 불러온다.
// 시험 파일마다 app/ 을 부르면 구조 규칙(components → app 금지)에 걸리므로 여기서 한 번 부른다.
import "@/app/globals.css";
