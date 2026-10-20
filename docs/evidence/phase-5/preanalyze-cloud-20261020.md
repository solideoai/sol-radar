# 클라우드 Supabase 사전 분석 (10 기동 절차 12~14, 2026-10-20)

- main `c03910e`, 호스트 web `pnpm -C web dev` :3000, Compose `sol-radar-stack` 재빌드. 비밀값 없음.
- 12 `pnpm demo:reset`: 마지막 줄 `seed: orgs=2 users=5 profileRevisions=2 people=200 portraits=200 bids=19 quarantined=1 reviews=2 isDemo=true` (2회 실행, 2회째 계정 새로 만든 0). 요약 `demo-reset-cloud-20261020.json`(phase-1).
- 13 `pnpm check:env`: 통과(실행 모드 mock, placeholder 0, 모드 모순 0). `GET /health/ready` → `{"status":"ok","checks":{"db":"ok","redis":"ok","storage":"ok","ai":"mock"}}`
- 14 `pnpm demo:preanalyze` (14:05 KST): `preanalyze: targets=18 completed=18 partial=0 failed=0`

## compose ps
```
sol-radar-stack-ai-gateway-1 Up 6 minutes (healthy)
sol-radar-stack-minio-1 Up 6 minutes (healthy)
sol-radar-stack-qdrant-1 Up 6 minutes (healthy)
sol-radar-stack-redis-1 Up 6 minutes (healthy)
sol-radar-stack-worker-1 Up 6 minutes (healthy)
```

## worker 로그 (분석 요약)
```
{"event":"analysis.completed","jobId":"analysis_db4c863c-cb6a-593d-93ff-709a17e0157a_fd35d312-595e-45ec-bba5-f129472900af","requestId":"demo-pre-FX-14-r01","orgId":"db4c863c-cb6a-593d-93ff-709a17e0157a","scoreRunId":"fd35d312-595e-45ec-bba5-f129472900af","bidId":"29dc6ded-e564-5d29-82ec-ea9806ad48b1","attempt":1,"status":"COMPLETED","errorCode":null,"recommendationBasis":"RULES_WITH_KEV_ASSIST","settingsSource":"HEALTH","runModeMismatch":false,"elapsedMs":2494}
{"event":"analysis.completed","jobId":"analysis_db4c863c-cb6a-593d-93ff-709a17e0157a_c9da9ee2-9492-4a27-8dad-bd5dc72c5ed2","requestId":"demo-pre-FX-15-r01","orgId":"db4c863c-cb6a-593d-93ff-709a17e0157a","scoreRunId":"c9da9ee2-9492-4a27-8dad-bd5dc72c5ed2","bidId":"f66379fe-96c4-5ffc-a1c3-f36bad5c1299","attempt":1,"status":"COMPLETED","errorCode":null,"recommendationBasis":"RULES_WITH_KEV_ASSIST","settingsSource":"HEALTH","runModeMismatch":false,"elapsedMs":2592}
{"event":"analysis.completed","jobId":"analysis_db4c863c-cb6a-593d-93ff-709a17e0157a_bb20ece5-6d37-400d-b028-51fe0ba4c6a5","requestId":"demo-pre-FX-16-r01","orgId":"db4c863c-cb6a-593d-93ff-709a17e0157a","scoreRunId":"bb20ece5-6d37-400d-b028-51fe0ba4c6a5","bidId":"9f10f9dc-7a52-5616-8bfd-b65d74285a9d","attempt":1,"status":"COMPLETED","errorCode":null,"recommendationBasis":"RULES_WITH_KEV_ASSIST","settingsSource":"HEALTH","runModeMismatch":false,"elapsedMs":2149}
{"event":"analysis.completed","jobId":"analysis_db4c863c-cb6a-593d-93ff-709a17e0157a_c63db508-2806-48f5-8439-9fe2a531e15e","requestId":"demo-pre-FX-17-r01","orgId":"db4c863c-cb6a-593d-93ff-709a17e0157a","scoreRunId":"c63db508-2806-48f5-8439-9fe2a531e15e","bidId":"8db93cc7-fae2-557e-a8bc-ca4e5352e10c","attempt":1,"status":"COMPLETED","errorCode":null,"recommendationBasis":"RULES_WITH_KEV_ASSIST","settingsSource":"HEALTH","runModeMismatch":false,"elapsedMs":2734}
{"event":"analysis.completed","jobId":"analysis_db4c863c-cb6a-593d-93ff-709a17e0157a_c4ba3447-f1ba-4594-af03-4ea2ed4fb130","requestId":"demo-pre-FX-18-r01","orgId":"db4c863c-cb6a-593d-93ff-709a17e0157a","scoreRunId":"c4ba3447-f1ba-4594-af03-4ea2ed4fb130","bidId":"5f28b611-29d8-59fa-92eb-a0c453b91cd0","attempt":1,"status":"COMPLETED","errorCode":null,"recommendationBasis":"RULES_WITH_KEV_ASSIST","settingsSource":"HEALTH","runModeMismatch":false,"elapsedMs":2493}
{"event":"analysis.completed","jobId":"analysis_db4c863c-cb6a-593d-93ff-709a17e0157a_e7b66a20-9c13-48da-af14-5cb9cca81121","requestId":"demo-pre-FX-19-r01","orgId":"db4c863c-cb6a-593d-93ff-709a17e0157a","scoreRunId":"e7b66a20-9c13-48da-af14-5cb9cca81121","bidId":"f1b8fdee-7493-542e-b800-3a60b6ee7032","attempt":1,"status":"COMPLETED","errorCode":null,"recommendationBasis":"RULES_WITH_KEV_ASSIST","settingsSource":"HEALTH","runModeMismatch":false,"elapsedMs":2390}
{"event":"analysis.completed","jobId":"analysis_db4c863c-cb6a-593d-93ff-709a17e0157a_5ed4858e-4478-41cf-9057-febe61953d77","requestId":"demo-pre-FX-20-r01","orgId":"db4c863c-cb6a-593d-93ff-709a17e0157a","scoreRunId":"5ed4858e-4478-41cf-9057-febe61953d77","bidId":"1cfcc05b-daaf-5a55-950c-ce2422b996b5","attempt":1,"status":"COMPLETED","errorCode":null,"recommendationBasis":"RULES_WITH_KEV_ASSIST","settingsSource":"HEALTH","runModeMismatch":false,"elapsedMs":2136}
{"event":"analysis.reconcile.summary","checked":0,"requeued":0,"failed":0,"inFlight":0}
```
