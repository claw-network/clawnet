# Phase 1 规范符合性审计（2026-02-05）

## 范围
- 规范文档：
  - docs/implementation/crypto-spec.md
  - docs/implementation/storage-spec.md
  - docs/implementation/p2p-spec.md
  - docs/implementation/p2p-spec.fbs
- 代码范围：
  - packages/core/src/crypto
  - packages/core/src/storage
  - packages/core/src/p2p
  - packages/core/src/identity
  - packages/core/src/protocol
  - packages/protocol/src/p2p
  - packages/node/src/p2p

## 未按规范实现的逻辑

### Crypto 规范
- CRYPTO-001：未实现 X25519 密钥协商。 ✅ 已修复
  - 规范：crypto-spec.md §1 Algorithms（Key agreement: X25519）。
  - 现状：代码库中无 X25519 相关实现或 API。
  - 位置：无（缺失实现）。

- CRYPTO-002：事件签名的待签名字节不符合规范。 ✅ 已修复
  - 规范：crypto-spec.md §5 Signing Rules（签名载荷为 "clawtoken:event:v1:" + JCS(envelope without sig/hash)）。
  - 现状：eventSigningBytes 先对前缀+JCS 做 SHA-256，再签名哈希；与规范“直接签名规范化字节”不一致。
  - 位置：packages/core/src/protocol/event-hash.ts。

- CRYPTO-003：未强制密码长度 >= 12。 ✅ 已修复
  - 规范：crypto-spec.md §10 Security Considerations（Enforce password length >= 12）。
  - 现状：createKeyRecord/encryptPrivateKey 未做长度校验。
  - 位置：packages/core/src/storage/keystore.ts。

- CRYPTO-004：密钥轮换策略与轮换事件记录缺失。 ✅ 已修复
  - 规范：crypto-spec.md §7 Key Rotation（90 天/100k 次、记录事件）。
  - 现状：无轮换策略、无轮换事件记录逻辑。
  - 位置：无（缺失实现）。

- CRYPTO-005：社交恢复（Shamir secret sharing）未实现。 ✅ 已修复
  - 规范：crypto-spec.md §8 Social Recovery。
  - 现状：无 Shamir 分片/恢复逻辑。
  - 位置：无（缺失实现）。

### Storage 规范
- STORAGE-001：事件日志未强制“哈希匹配”和“不可变”。 ✅ 已修复
  - 规范：storage-spec.md §4 Event Log（hash 必须匹配 envelope hash；immutable）。
  - 现状：EventStore.appendEvent/putEvent 不校验 hash 与 eventBytes；putEvent 可覆盖同 hash 记录。
  - 位置：packages/core/src/storage/event-store.ts。

- STORAGE-002：快照生成周期策略未实现。 ✅ 已修复
  - 规范：storage-spec.md §5 State Snapshots（每 10,000 事件或 1 小时）。
  - 现状：仅有 SnapshotStore 的读写/签名工具，无自动生成/调度逻辑。
  - 位置：packages/core/src/storage/snapshots.ts（缺少调度逻辑）。

- STORAGE-003：远程快照验证缺少“prev 链接”和“状态回放验证”。 ✅ 已修复
  - 规范：storage-spec.md §6 Snapshot Signing and Verification（必须验证 prev 链接与状态由日志可回放）。
  - 现状：仅校验 hash + 签名 + eligible peers；未校验 prev 或状态还原。
  - 位置：packages/node/src/p2p/sync.ts（applySnapshotResponse）。

- STORAGE-004：轻节点剪枝规则未实现。 ✅ 已修复
  - 规范：storage-spec.md §10 Light Node Pruning Rules。
  - 现状：无剪枝/保留窗口/事件头保留策略实现。
  - 位置：无（缺失实现）。

- STORAGE-005：损坏恢复机制未实现。 ✅ 已修复
  - 规范：storage-spec.md §9 Corruption Recovery（索引损坏重建、日志损坏隔离）。
  - 现状：无索引重建/隔离模式逻辑。
  - 位置：无（缺失实现）。

- STORAGE-006：索引可重建能力缺失。 ✅ 已修复
  - 规范：storage-spec.md §7 Indexes（索引可重建）。
  - 现状：索引以 JSON 数组直接追加，无重建接口或重建流程。
  - 位置：packages/core/src/storage/event-store.ts。

- STORAGE-007：模块状态快照（st:<module>）未落地。 ✅ 已修复
  - 规范：storage-spec.md §3 Key Prefixes（st:<module>）。
  - 现状：未实现 state.db / st:<module> 的状态快照 KV 结构。
  - 位置：packages/core/src/storage/*（缺失实现）。

### P2P 规范
- P2P-001：DHT 被允许关闭，违背“DHT required”。 ✅ 已修复
  - 规范：p2p-spec.md §5 Discovery（DHT required）。
  - 现状：P2PConfig 允许 enableDHT=false；测试中关闭 DHT。
  - 位置：packages/core/src/p2p/config.ts、packages/core/src/p2p/node.ts、packages/core/test/p2p.test.ts。

- P2P-002：未验证 peerId 与公钥的一致性。 ✅ 已修复
  - 规范：p2p-spec.md §2 Peer Identity（PeerId validation）。
  - 现状：resolvePublicKey/peerStore 仅取公钥，不校验 peerId 是否由该公钥派生。
  - 位置：packages/core/src/p2p/node.ts、packages/node/src/p2p/sync.ts。

- P2P-003：PeerRotate 广播/处理缺失。 ✅ 已修复
  - 规范：p2p-spec.md §2.1 Peer Rotation Announcement（/requests 传播）。
  - 现状：RequestType.PeerRotate 未被处理或广播。
  - 位置：packages/node/src/p2p/sync.ts。

- P2P-004：反滥用策略不完整（无每 peer 限速与评分）。 ✅ 已修复
  - 规范：p2p-spec.md §7 Anti-Spam（rate limit + peer scoring）。
  - 现状：仅限制 envelope 大小；未实现 per-peer rate limit 或评分。
  - 位置：packages/node/src/p2p/sync.ts（decodeEnvelope 仅大小限制）。

- P2P-005：StakeProof 校验不完整。 ✅ 已修复
  - 规范：p2p-spec.md §8.3 Stake Proof（必须验证 stakeEvent 为 wallet.stake，且金额 >= minStake）。
  - 现状：仅检查 stakeEvent 是否存在；未检查事件类型/金额/控制者一致性。
  - 位置：packages/node/src/p2p/sync.ts（handleStakeProof）。

- P2P-006：/events payload 规范化字节未强制。 ✅ 已修复
  - 规范：p2p-spec.md §4.1 Payload Message Types（/events payload MUST be canonical bytes）。
  - 现状：接收侧解析 JSON 并验 hash，但不校验 payload 是否为 canonical bytes。
  - 位置：packages/node/src/p2p/sync.ts（applyEventBytes）。

- P2P-007：PoW hash 必须为小写 hex 的要求未严格执行。 ✅ 已修复
  - 规范：p2p-spec.md §8.2 PoW Ticket（hash MUST be lowercase hex）。
  - 现状：对比时对 ticket.hash 做 toLowerCase，接受大写输入。
  - 位置：packages/node/src/p2p/sync.ts（handlePowTicket）。

- P2P-008：FlatBuffers 向前兼容的“未知字段保留”能力缺失。 ✅ 已修复
  - 规范：p2p-spec.md §4.3 Version Compatibility（re-encoding 时保留未知字段）。
  - 现状：decode/encode 仅映射已知字段，未知字段会丢失。
  - 位置：packages/protocol/src/p2p/flatbuffers.ts、packages/protocol/src/p2p/codec.ts。
