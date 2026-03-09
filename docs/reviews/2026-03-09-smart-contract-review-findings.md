# Smart Contract Review Findings

- Review date: 2026-03-09
- Scope: `packages/contracts/contracts`
- Focus: contract logic completeness, especially incentive, staking, governance, identity, escrow, and reputation flows
- Finding count: 9

## 1. [P0] Authenticate reward claims against relay and peer DIDs

- File: `packages/contracts/contracts/ClawRelayReward.sol:154`
- `claimReward()` never proves that `msg.sender` controls `relayDidHash`, and it never validates any `PeerConfirmation.signature` against an on-chain identity source. As written, any funded deployment can be drained by an arbitrary EOA that invents fresh relay/peer DID hashes, supplies caller-chosen byte counts above the thresholds, and repeats with new `periodId` values until the pool is empty.

## 2. [P1] Derive relay payouts from confirmed traffic on-chain

- File: `packages/contracts/contracts/ClawRelayReward.sol:212`
- This branch trusts the caller-provided `rewardAmount` and only caps it at `maxRewardPerPeriod`; it never computes the documented reward from the confirmed traffic, never uses `attachmentWeightBps`, and never uses `circuitsServed`. That means any claimant who clears the minimum thresholds can always request the period maximum regardless of the actual relay work performed, which breaks the intended incentive curve and overpays the pool.

## 3. [P1] Block restaking while an unstake is still pending

- File: `packages/contracts/contracts/ClawStaking.sol:155`
- After `requestUnstake()`, the account still has a nonzero stake locked in the contract, but `active` is flipped to `false`. Because `stake()` only checks `active`, the same address can stake again during the cooldown, which overwrites the old `StakeInfo` and clears the pending withdrawal. The first stake remains in the contract balance with no accounting path to recover it, so a cooldown restake can permanently strand user funds.

## 4. [P1] Reserve token balance before crediting staking rewards

- File: `packages/contracts/contracts/ClawStaking.sol:280`
- `distributeRewards()` only increments the in-storage `rewards` counters; it never checks or reserves any liquid token balance for those liabilities. `claimRewards()` later pays from the contract's raw ERC-20 balance, which is mostly staked principal, so a distributor can over-credit rewards and let early claimers drain other users' stake, causing later reward claims or unstakes to fail.

## 5. [P1] Freeze quorum against the proposal snapshot supply

- File: `packages/contracts/contracts/ClawDAO.sol:440`
- Voting power is snapshotted at proposal creation, but quorum is still measured against `token.totalSupply()` at the time `hasQuorum()` runs. If supply changes after voting starts, for example through a later mint or burn, a proposal can flip between meeting and missing quorum without any voter changing their vote. The quorum denominator needs to be snapshotted alongside voting power.

## 6. [P1] Preserve epoch numbering when changing epochDuration

- File: `packages/contracts/contracts/ClawReputation.sol:343`
- Changing `epochDuration` without rebasing `epochStart` makes `getCurrentEpoch()` reinterpret all past timestamps under a new divisor. Once that happens, the current epoch can move backward, and the next `anchorReputation()` call writes into an already-used `snapshotHistory[agent][epoch]` slot instead of creating a new period entry, corrupting historical reputation data.

## 7. [P1] Deactivate validators that are fully slashed

- File: `packages/contracts/contracts/ClawStaking.sol:255`
- A full slash only increments `s.slashed`; it never clears `active` or removes the address from `_activeValidators`. That leaves a node with zero effective stake still visible as active and still eligible for downstream logic such as validator enumeration, reward distribution inputs, or DAO lockup multipliers until it voluntarily requests unstake, which defeats slashing as an immediate removal mechanism.

## 8. [P2] Reject disputes once an escrow has already expired

- File: `packages/contracts/contracts/ClawEscrow.sol:279`
- `dispute()` only checks that the escrow is still `Active`; it does not reject calls after `expiresAt`. In the post-expiry window before anyone calls `expire()`, either party can move the escrow to `Disputed`, which disables the immediate expiry path and forces the depositor to wait for arbiter action or the 7-day timeout instead of getting the prompt refund the expiry flow is supposed to provide.

## 9. [P2] Domain-separate DID controller signatures

- File: `packages/contracts/contracts/ClawIdentity.sol:145`
- The controller signature digest only includes the operation tag, `didHash`, and controller address, so the same signature is valid on every `ClawIdentity` deployment and chain. A signature collected for one environment can therefore be replayed on another deployment or fork to register or rotate the DID there without a new approval, which is avoidable by binding the digest to `block.chainid` and the contract address.
