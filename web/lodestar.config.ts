import { defineConfig } from "@retemper/lodestar";
import { pluginArchitecture } from "@retemper/lodestar-plugin-architecture";

/**
 * 구조 규칙 — 층(layer)마다 부를 수 있는 층을 정한다.
 *
 * 파일이 몇 개 없을 때는 손으로도 지킬 수 있다. 늘어나면 하나를 고칠 때
 * 어디까지 영향이 가는지 알 수 없게 되는데, 그때 정리하는 것보다 지금
 * 못 박아 두는 편이 싸다.
 *
 * 규칙을 바꾸려면 canImport를 고친다. 어긴 코드는 pnpm -C web lodestar에서 걸린다.
 */
export default defineConfig({
  plugins: [pluginArchitecture],
  rules: {
    "architecture/layers": {
      severity: "error",
      options: {
        layers: [
          // 화면. 서버의 도메인만 부른다. 서버의 데이터베이스 접속 코드는 직접 못 부른다
          { name: "ui", path: "app/**", canImport: ["components", "domain", "shared", "lib"] },
          { name: "components", path: "components/**", canImport: ["domain", "shared", "lib"] },

          // 브라우저에서 쓰는 도구. 브라우저용 Supabase 클라이언트(supabase-browser.ts)가 여기 있다.
          // 서버 전용(server/**)이 아니라 화면에서도 부를 수 있는 자리다.
          { name: "lib", path: "lib/**", canImport: ["shared"] },

          // 도메인. 무엇을 하는 서비스인지가 여기 있다.
          // 와일드카드라 도메인을 새로 만들어도(server/subscription 등) 이 파일을 안 고쳐도 된다.
          //
          // ⚠️ 순서가 규칙의 일부다. 한 파일이 여러 층에 걸리면 '나중에 선언한 층'이 이긴다.
          // server/supabase·server/shared 도 이 와일드카드에 걸리지만, 아래에서 다시 선언하므로
          // 각각 infra·shared 로 확정된다. 세 줄의 순서를 바꾸면 규칙이 조용히 무너진다.
          { name: "domain", path: "server/*/**", canImport: ["infra", "shared"] },

          // 데이터베이스 접속
          { name: "infra", path: "server/supabase/**", canImport: ["shared"] },

          // 공통. 아무것도 부르지 않는다
          { name: "shared", path: "server/shared/**", canImport: [] },

          // worker. service role 을 쓰는 유일한 런타임이라 infra 를 직접 부른다.
          // 다른 층의 canImport 에는 worker 를 넣지 않는다(worker 는 아무도 부르지 않는다)
          { name: "worker", path: "worker/**", canImport: ["domain", "infra", "shared"] },
        ],
        allowTypeOnly: true,
      },
    },

    // 서로 물고 도는 참조 금지
    "architecture/no-circular": "error",
  },
});
