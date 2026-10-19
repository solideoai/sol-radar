# 회사 GPU 서버 모델 라우터 (ADR-025)

회사 nginx 가 `https://acropolissg.com/sol-radar` 하나만 등록할 수 있어, 그 뒤에서 경로를 나누는 작은 nginx 를 둔다.
노트북 ai-gateway 는 `QWEN_BASE_URL=https://acropolissg.com/sol-radar/qwen`, `KEV_BASE_URL=https://acropolissg.com/sol-radar/kev` 로 붙는다.

## 회사 nginx 에 부탁할 것 (location 하나)

```nginx
location /sol-radar/ {
    proxy_pass http://127.0.0.1:8080;          # 접두어를 떼지 않는다(떼도 라우터가 받는다)
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Authorization $http_authorization;   # 기본값도 통과시키지만 명시한다
    proxy_read_timeout 300s;                   # 기본 60s 면 긴 RFP 추출이 504 로 끊긴다
    proxy_send_timeout 300s;
    client_max_body_size 20m;                  # 기본 1m 면 첨부 본문을 담은 추출 요청이 413 이다
    proxy_buffering off;
}
```

## GPU 서버에서 띄우기

1. vLLM·kev.serve 를 `docs/10-DEPLOYMENT.md` 의 명령으로 호스트 `127.0.0.1:8001`·`127.0.0.1:8009` 에 띄운다(`--api-key`, `KEV_API_KEY` 필수).
2. 라우터: 컨테이너면 `docker compose -f infra/compose.gpu.yaml up -d`(Linux, host 네트워크). 호스트 nginx 를 쓰면 `infra/gpu/model-router.conf` 를 `/etc/nginx/conf.d/sol-radar-router.conf` 로 두고 `nginx -t && nginx -s reload`.
3. 서버 안에서 확인(키는 셸 변수로만, 값을 출력하지 않는다):

```bash
curl -s http://127.0.0.1:8080/healthz                                   # ok
curl -s -H "Authorization: Bearer $QWEN_API_KEY" http://127.0.0.1:8080/sol-radar/qwen/v1/models
curl -s -H "Authorization: Bearer $KEV_API_KEY"  http://127.0.0.1:8080/sol-radar/kev/v1/models
```

## 밖에서 확인 (우리 쪽 C1 ③ G1·G2)

```bash
curl -sS -o /dev/null -w 'http=%{http_code}\n' https://acropolissg.com/sol-radar/healthz    # 200, TLS 유효(-k 금지)
curl -sS -o /dev/null -w 'http=%{http_code}\n' https://acropolissg.com/sol-radar/kev/v1/models   # 인증 없이 401 또는 403
```

## 바뀌면 알려 줄 것

- 바깥 nginx 가 접두어를 떼는지(둘 다 동작하지만 기록한다)
- 라우터 포트(8080)·런타임 포트(8001·8009)를 바꿨는지
- 회사 프록시 단의 추가 인증(기본 인증·IP 허용·별도 헤더)이 있는지
