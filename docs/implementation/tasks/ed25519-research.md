# Ed25519 On-Chain Verification — Research & Decision

> T-0.13 产出物。评估 Ed25519 签名在 ClawNet Chain（独立 EVM 链）上的验证方案。

## 1. 背景

ClawNet 的 DID 体系使用 Ed25519 密钥对。关键操作（密钥轮换 `rotateKey`）需要验证
旧密钥对新密钥的签名授权。问题在于 EVM 原生不支持 Ed25519（仅支持 secp256k1 的 `ecrecover`）。

## 2. 方案对比

### 方案 A：Reth 自定义预编译

- **原理**：在 Reth 节点软件中注册一个自定义预编译合约（如 `0x0100`），
  接受 `(message, signature, pubkey)` 输入，执行 Ed25519 验证，返回 `bool`。
- **优点**：
  - Gas 成本极低（~3,000 gas，类似 `ecrecover`）
  - 链上验证最安全
  - ClawNet 是独立链，可自由添加预编译
- **缺点**：
  - 需要 Fork Reth 源码（Rust），增加维护成本
  - 升级 Reth 时需合并自定义代码
  - 需要所有验证者节点同步升级
- **工时**：~5 天（Rust 实现 + 测试 + 节点端部署）
- **风险**：中等（Reth API 可能变动）

### 方案 B：纯 Solidity Ed25519 验证库

- **原理**：将 Ed25519 算术（Edwards 曲线点乘、模运算）用 Solidity 实现。
  参考实现：[0age/ed25519-sol](https://github.com/0age/ed25519-sol)、
  [javierlinero/solidity-ed25519](https://github.com/javierlinero/solidity-ed25519)。
- **优点**：
  - 纯合约层面，不依赖节点软件
  - 可在任何 EVM 链使用
  - 无需 Reth fork
- **缺点**：
  - **Gas 极高**：约 1,200,000–1,500,000 gas per verification（模幂运算昂贵）
  - 即使用 `MODEXP` 预编译（0x05）优化，仍需约 500,000–800,000 gas
  - 审计面大（复杂密码学）
  - 已知 Solidity 实现未经过大规模生产验证
- **工时**：~3 天（集成 + 测试）
- **风险**：高（Gas 成本不可接受，且库可能有 bug）

### 方案 C：链下验证 + 链上提交（✅ 推荐）

- **原理**：
  1. 签名验证在链下完成（Node 服务层用 `@noble/ed25519` 验证）
  2. 验证通过后，由 **授信角色**（controller 或 REGISTRAR）提交链上交易
  3. 链上合约仅验证调用方权限（`onlyController` / `onlyRole`），
     不重复验证 Ed25519 签名
  4. `rotationProof` 存储到链上（可选），供审计追溯

  安全性分析：
  - `rotateKey()` 已有 `onlyController(didHash)` 修饰符，仅 DID controller 可调用
  - Controller 就是持有私钥的 EVM 账户
  - 攻击者无法在不控制 controller 私钥的情况下调用 rotateKey
  - 因此链下验证 + 链上权限检查的组合是安全的

- **优点**：
  - **零额外 Gas 成本**
  - 不需要 Reth fork
  - 实现简单，当前 ClawIdentity.sol 已经是此模式
  - 可在 Phase 2 随时升级到方案 A（添加预编译后加一个 `verify()` 调用即可）
- **缺点**：
  - 签名验证不在链上，无法被其他合约调用验证
  - 依赖 controller EVM 私钥安全
- **工时**：~0.5 天（当前实现已满足，仅需写辅助函数）
- **风险**：低

### 方案 D：EIP-2537 / RIP-7696 等标准预编译

- **原理**：等待以太坊生态标准化 Ed25519 预编译。
- **状态**：目前无 EIP 计划支持 Ed25519（EIP-2537 是 BLS12-381）。
  有 [RIP-7696](https://github.com/ethereum/RIPs/blob/master/RIPS/rip-7696.md) 提案
  但针对的是 secp256r1，非 Ed25519。
- **结论**：短期不可行，不等待。

## 3. 决策

**采用方案 C（链下验证 + 链上提交）作为 MVP 方案。**

理由：
1. ClawIdentity.sol 已实现此模式，代码已通过 49 个测试，覆盖率 100%
2. Gas 成本为零（无额外验证开销）
3. 安全性由 `onlyController` 保障，与 EVM 原生安全模型一致
4. 保持升级路径：Phase 2 可通过添加 Reth 自定义预编译无缝升级到方案 A

**Phase 2 升级路线**：
1. 在 Reth 中添加 Ed25519 预编译（方案 A）
2. Ed25519Verifier.sol 调用预编译进行验证
3. ClawIdentity.rotateKey() 添加可选的链上验证调用
4. 通过 DAO 提案启用链上验证（开关参数存 ParamRegistry）

## 4. Ed25519Verifier.sol 当前实现

基于方案 C，`Ed25519Verifier.sol` 提供链下辅助工具而非链上验证：

```solidity
library Ed25519Verifier {
    /// @notice Placeholder for future on-chain verification.
    ///         Currently verification is performed off-chain.
    ///         Phase 2 will add: verify(bytes32 message, bytes sig, bytes pubkey) → bool
    ///         using a custom precompile at address 0x0100.

    /// @dev Compute the signing payload for key rotation.
    function rotationPayload(
        bytes32 didHash,
        bytes32 oldKeyHash,
        bytes32 newKeyHash
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("clawnet:rotate:v1:", didHash, oldKeyHash, newKeyHash));
    }
}
```

链下验证辅助函数在 `packages/core` 和 `scripts/` 中提供。

## 5. 参考

- [ed25519 RFC 8032](https://tools.ietf.org/html/rfc8032)
- [@noble/ed25519](https://github.com/paulmillr/noble-ed25519) — TypeScript 实现
- [Reth Custom Precompile Docs](https://paradigmxyz.github.io/reth/docs/) 
- ClawNet crypto-spec: `docs/implementation/crypto-spec.md`
- ClawIdentity.sol: 当前已实现链下验证 + onlyController 模式

---

*结论：方案 C 已在 Phase 1 中实现并通过测试。Phase 2 可按需升级到方案 A。*
*更新日期: 2026-02-22*
