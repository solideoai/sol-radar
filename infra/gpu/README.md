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

## 학습 전용 GPU: Kev-9B LoRA F1 (ADR-027, 2026-10-20 서버 확인)

위 라우터·vLLM·`kev.serve`(추론)와 별개다. 학습(F1·F2·F3)과 E4 채점은 **물리 GPU 1 한 장**만 쓴다. 정본은 `docs/22-FINETUNE-RUNBOOK.md` §3·§4, `docs/23-WEEKEND-FINETUNE.md`, `docs/10-DEPLOYMENT.md` "학습 전용 GPU".

| 물리 GPU(nvidia-smi index) | 모델 | VRAM | 2026-10-20 사용량 | 정책 |
|---|---|---:|---:|---|
| 0 | NVIDIA A40 | 46,068 MiB | 4,747 MiB | 회사 기존 서비스. **쓰지 않는다** |
| 1 | NVIDIA A40 (CC 8.6) | 46,068 MiB | 5 MiB | **SOL RADAR 학습 전용** |
| 2 | NVIDIA A40 | 46,068 MiB | 9,240 MiB | 회사 기존 서비스. **쓰지 않는다** |

- 서버 `sol-NF5280M6`, 계정 `bim`, 작업 경로 `/data/www/ai_workspace/sol-radar`, venv `.venv-kev`(Python 3.12.3, torch 2.8.0+cu128, triton 3.4.0). 드라이버 580.173.02(CUDA 13.0), CUDA Toolkit 12.8.
- 매 셸 세션마다 `export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1`. 프로세스 안에서는 GPU 1 이 `cuda:0` 으로 보인다(정상). SSH 를 다시 열면 사라지므로 두 스크립트가 값을 확인하고 없으면 멈춘다.
- GPU 0·2 의 프로세스를 종료·이동·설정 변경하지 않는다. 두 스크립트는 `kill`·`pkill`·`docker compose down` 을 쓰지 않는다(`kev-f1.sh` 가 끝낼 때 멈추는 것은 자기가 띄운 `nvidia-smi -l 1` 기록 프로세스뿐이다). GPU 1 에 다른 프로세스가 있으면 종료하지 않고 멈춘 뒤 회사에 확인한다.
- `CUDA_VISIBLE_DEVICES` 는 다른 사람의 GPU 사용을 막지 못한다. 실행 전후 `nvidia-smi` 로 GPU 1 상태를 확인한다(스크립트가 `*.pre.txt`·`*.post.txt` 로 남긴다).

```bash
export CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1
bash infra/gpu/kev-preflight.sh                 # F1-A: 환경·GPU 매핑·커널 smoke·모델 sha256·데이터 길이. 통과 표식 runs/preflight-ok
bash infra/gpu/kev-f1.sh --max_state 1024       # F1-B: 20 step. PASS 면 2048 → 4096 → 6144 순으로 한 번에 하나씩
```

결과는 `runs/<이름>.summary.md`·`runs/f1-results.md` 에 남고, `docs/evidence/kev-train-feasibility.md` 표에 옮긴다. 20 step PASS 는 F2 착수 조건의 일부일 뿐이다(`dropped 0`·안전 여유·데이터 보고 항목은 22 §4.2).
