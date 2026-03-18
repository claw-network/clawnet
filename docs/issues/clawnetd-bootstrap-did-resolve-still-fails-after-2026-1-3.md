# ClawNet Bootstrap DID Resolve 仍失败（2026.1.3 后复现）

日期: 2026-03-18
报告方: TelAgent 项目组
优先级: P0
关联 Issue:
- clawnetd-bootstrap-did-resolve-and-multi-bootstrap.md
- docs/issues/reply/clawnetd-bootstrap-did-resolve-and-multi-bootstrap.md

---

## 摘要

我们已按 ClawNet 团队回复要求完成升级和重部署：

- bootstrap (clawnetd.com): 2026.1.3
- Alex: 2026.1.3
- Bess: 2026.1.3
- 本地嵌入式 ClawNet: 2026.1.3

但 NAT 本地节点到 Alex/Bess DID 的消息仍然无法投递，仍表现为 peer_unknown。

控制组（本地 -> bootstrap DID）可成功 delivered=true。

结论：问题仍卡在 DID 解析阶段（bootstrap 对目标 DID 未返回可用映射），不是 TelAgent 应用层逻辑错误。

---

## 环境与版本

- 本地 ClawNet API: 127.0.0.1:9528
- 本地 DID: did:claw:zBkpYijx56swvPB65VDb8gUbUVk3nNyPdjdhNaoiyQh93
- bootstrap DID: did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR
- Alex DID: did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA
- Bess DID: did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs

版本确认:

1) bootstrap
- GET https://api.clawnetd.com/api/v1/node -> version=2026.1.3, peers=5

2) Alex
- /opt/clawnet commit: 1424fed
- /opt/telagent commit: 1ecced6
- GET http://127.0.0.1:9528/api/v1/node -> version=2026.1.3, peers=2

3) Bess
- /opt/clawnet commit: 1424fed
- /opt/telagent commit: 1ecced6
- GET http://127.0.0.1:9528/api/v1/node -> version=2026.1.3, peers=2

4) 本地
- GET http://127.0.0.1:9528/api/v1/node -> version=2026.1.3, peers=1

---

## 协议级复现（绕过 TelAgent 业务逻辑）

我们直接调用 ClawNet Messaging API（不是 TelAgent 联系人 API），结果如下：

### Case A: 本地 -> bootstrap DID（控制组）

请求:
- POST /api/v1/messaging/send
- targetDid = did:claw:zFy3Ed8bYu5SRHq5YK1YRz58iUpWxL27exCwngDwuH8gR

结果:
- delivered = true
- messageId = msg_direct_mmvsvxj7

### Case B: 本地 -> Alex DID

请求:
- POST /api/v1/messaging/send
- targetDid = did:claw:z8MifVfD6GGBeNE4ThZfM3R8tK1daNvrEHWSjRzQuELPA

结果:
- delivered = false
- messageId = msg_002e957489b1b57059b58612

本地日志:
- message queued in outbox
- reason = peer_unknown

### Case C: 本地 -> Bess DID

请求:
- POST /api/v1/messaging/send
- targetDid = did:claw:z4MnGwHRz2TXHfqZFuWNEfwXikMAWdK5yxzerWSf1paWs

结果:
- delivered = false
- messageId = msg_0c0c3420e6666f0b5a4c4e2e

本地日志:
- message queued in outbox
- reason = peer_unknown

---

## 关键证据

### 1) 本地 didPeerMap 只有 bootstrap DID

调用:
- GET http://127.0.0.1:9528/api/v1/messaging/peers

结果:
- didPeerMap 仅包含 did:claw:zFy3Ed8b... -> 12D3KooWQnQQ...
- 不包含 Alex DID / Bess DID

### 2) 云节点 didPeerMap 不包含本地 DID

Alex didPeerMap:
- 包含 bootstrap DID
- 包含 Bess DID
- 不包含本地 DID

Bess didPeerMap:
- 包含 bootstrap DID
- 包含 Alex DID
- 不包含本地 DID

### 3) TelAgent 表现与协议级结果一致

本地 TelAgent profile-card 发送时：
- sendProfileCard target=Alex DID
- message queued in outbox
- reason=peer_unknown
- profile 查询返回 data=null

说明应用层只是暴露了底层失败，并非应用层数据处理 bug。

---

## 影响

- WebApp 添加联系人时，昵称和头像无法自动回填
- NAT 本地节点无法通过 bootstrap 解析公网节点 DID
- profile-card 交换不可用，联系人体验严重受损

---

## 需要 ClawNet 团队确认/修复

1) 请给出 2026.1.3 在 bootstrap 上的可验证 DID resolve 证据
- 在 bootstrap 节点抓取 handleDidResolve 命中日志
- 提供针对目标 DID 的 found=true 响应样例（含 peerId/multiaddrs）

2) 请确认 bootstrap 端 did announce 写入路径是否覆盖 NAT 对端
- 本地 did announce 是否被 bootstrap 收到并持久化
- Alex/Bess did announce 是否可被 NAT 节点查询到

3) 若 2026.1.3 仅修复超时机制但未保证 NAT 场景可解析，请给出新版本时间表
- 包含可验证的回归用例（Local NAT -> Alex DID delivered=true）

---

## TelAgent 侧后续计划（并行）

在等待 ClawNet 进一步修复期间，我们将并行评估 HTTP fallback 以恢复联系人资料可用性，避免用户侧功能长期不可用。
