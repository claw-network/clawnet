import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';

function didHash(did: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(did));
}

describe('TelagentGroupRegistry', () => {
  async function deployFixture() {
    const [admin, alice, bob, charlie] = await ethers.getSigners();

    const mockIdentityFactory = await ethers.getContractFactory('MockClawIdentity');
    const mockIdentity = await mockIdentityFactory.deploy();
    await mockIdentity.waitForDeployment();

    const groupFactory = await ethers.getContractFactory('TelagentGroupRegistry');
    const registry = await upgrades.deployProxy(groupFactory, [
      admin.address,
      await mockIdentity.getAddress(),
    ]);
    await registry.waitForDeployment();

    const aliceDid = 'did:claw:zAlice';
    const bobDid = 'did:claw:zBob';
    const charlieDid = 'did:claw:zCharlie';

    await mockIdentity.setDid(didHash(aliceDid), alice.address, true);
    await mockIdentity.setDid(didHash(bobDid), bob.address, true);
    await mockIdentity.setDid(didHash(charlieDid), charlie.address, false);

    return {
      registry,
      mockIdentity,
      admin,
      alice,
      bob,
      charlie,
      aliceDid,
      bobDid,
      charlieDid,
    };
  }

  it('creates group when caller controls active DID', async () => {
    const { registry, alice, aliceDid } = await deployFixture();
    const groupId = ethers.id('group-1');

    await expect(
      registry
        .connect(alice)
        .createGroup(groupId, didHash(aliceDid), 'alpha.tel', ethers.id('proof'), ethers.id('mls0')),
    ).to.emit(registry, 'GroupCreated');

    const group = await registry.getGroup(groupId);
    expect(group.creatorDidHash).to.equal(didHash(aliceDid));
    expect(group.active).to.equal(true);

    const memberState = await registry.getMemberState(groupId, didHash(aliceDid));
    expect(memberState).to.equal(2n); // Finalized
  });

  it('rejects createGroup if caller is not DID controller', async () => {
    const { registry, bob, aliceDid } = await deployFixture();

    await expect(
      registry
        .connect(bob)
        .createGroup(ethers.id('group-2'), didHash(aliceDid), 'alpha.tel', ethers.id('proof'), ethers.id('mls0')),
    ).to.be.revertedWithCustomError(registry, 'NotDidController');
  });

  it('enforces member invite/accept/remove lifecycle', async () => {
    const { registry, alice, bob, aliceDid, bobDid } = await deployFixture();

    const groupId = ethers.id('group-3');
    const inviteId = ethers.id('invite-1');

    await registry
      .connect(alice)
      .createGroup(groupId, didHash(aliceDid), 'alpha.tel', ethers.id('proof'), ethers.id('mls0'));

    await expect(
      registry
        .connect(alice)
        .inviteMember(groupId, inviteId, didHash(aliceDid), didHash(bobDid), ethers.id('commit-1')),
    ).to.emit(registry, 'MemberInvited');

    await expect(
      registry
        .connect(bob)
        .acceptInvite(groupId, inviteId, didHash(bobDid), ethers.id('welcome-1')),
    ).to.emit(registry, 'MemberAccepted');

    const stateAfterAccept = await registry.getMemberState(groupId, didHash(bobDid));
    expect(stateAfterAccept).to.equal(2n);

    await expect(
      registry
        .connect(alice)
        .removeMember(groupId, didHash(aliceDid), didHash(bobDid), ethers.id('commit-2')),
    ).to.emit(registry, 'MemberRemoved');

    const stateAfterRemove = await registry.getMemberState(groupId, didHash(bobDid));
    expect(stateAfterRemove).to.equal(3n);
  });

  it('rejects revoked DID participation', async () => {
    const { registry, alice, aliceDid, charlieDid, mockIdentity } = await deployFixture();
    const groupId = ethers.id('group-4');

    await registry
      .connect(alice)
      .createGroup(groupId, didHash(aliceDid), 'alpha.tel', ethers.id('proof'), ethers.id('mls0'));

    await mockIdentity.setDid(didHash(charlieDid), alice.address, false);

    await expect(
      registry
        .connect(alice)
        .inviteMember(groupId, ethers.id('invite-charlie'), didHash(aliceDid), didHash(charlieDid), ethers.id('commit')),
    ).to.be.revertedWithCustomError(registry, 'DidNotActive');
  });

  it('rejects duplicate invite and duplicate accept', async () => {
    const { registry, alice, bob, aliceDid, bobDid } = await deployFixture();
    const groupId = ethers.id('group-5');
    const inviteId = ethers.id('invite-x');

    await registry
      .connect(alice)
      .createGroup(groupId, didHash(aliceDid), 'alpha.tel', ethers.id('proof'), ethers.id('mls0'));

    await registry
      .connect(alice)
      .inviteMember(groupId, inviteId, didHash(aliceDid), didHash(bobDid), ethers.id('commit-1'));

    await expect(
      registry
        .connect(alice)
        .inviteMember(groupId, inviteId, didHash(aliceDid), didHash(bobDid), ethers.id('commit-2')),
    ).to.be.revertedWithCustomError(registry, 'InviteAlreadyExists');

    await registry
      .connect(bob)
      .acceptInvite(groupId, inviteId, didHash(bobDid), ethers.id('welcome-1'));

    await expect(
      registry
        .connect(bob)
        .acceptInvite(groupId, inviteId, didHash(bobDid), ethers.id('welcome-2')),
    ).to.be.revertedWithCustomError(registry, 'InviteAlreadyAccepted');
  });

  it('rejects invite and remove when caller is not group owner', async () => {
    const { registry, alice, bob, aliceDid, bobDid } = await deployFixture();
    const groupId = ethers.id('group-6');
    const inviteId = ethers.id('invite-non-owner');

    await registry
      .connect(alice)
      .createGroup(groupId, didHash(aliceDid), 'alpha.tel', ethers.id('proof'), ethers.id('mls0'));

    await expect(
      registry
        .connect(bob)
        .inviteMember(groupId, inviteId, didHash(bobDid), didHash(aliceDid), ethers.id('commit-non-owner')),
    ).to.be.revertedWithCustomError(registry, 'NotGroupOwner');

    await registry
      .connect(alice)
      .inviteMember(groupId, ethers.id('invite-owner'), didHash(aliceDid), didHash(bobDid), ethers.id('commit-owner'));
    await registry
      .connect(bob)
      .acceptInvite(groupId, ethers.id('invite-owner'), didHash(bobDid), ethers.id('welcome-owner'));

    await expect(
      registry
        .connect(bob)
        .removeMember(groupId, didHash(bobDid), didHash(bobDid), ethers.id('commit-remove-non-owner')),
    ).to.be.revertedWithCustomError(registry, 'NotGroupOwner');
  });

  it('rejects acceptInvite when caller is not the invited DID controller', async () => {
    const { registry, alice, bob, charlie, aliceDid, bobDid, charlieDid, mockIdentity } = await deployFixture();
    const groupId = ethers.id('group-7');
    const inviteId = ethers.id('invite-target-check');

    await registry
      .connect(alice)
      .createGroup(groupId, didHash(aliceDid), 'alpha.tel', ethers.id('proof'), ethers.id('mls0'));
    await registry
      .connect(alice)
      .inviteMember(groupId, inviteId, didHash(aliceDid), didHash(bobDid), ethers.id('commit-1'));

    // Make charlie active so mismatch is checked against invite target, not active status.
    await mockIdentity.setDid(didHash(charlieDid), charlie.address, true);

    await expect(
      registry
        .connect(charlie)
        .acceptInvite(groupId, inviteId, didHash(charlieDid), ethers.id('welcome-charlie')),
    ).to.be.revertedWithCustomError(registry, 'InviteeMismatch');
  });

  it('rejects removing group owner', async () => {
    const { registry, alice, aliceDid } = await deployFixture();
    const groupId = ethers.id('group-8');

    await registry
      .connect(alice)
      .createGroup(groupId, didHash(aliceDid), 'alpha.tel', ethers.id('proof'), ethers.id('mls0'));

    await expect(
      registry
        .connect(alice)
        .removeMember(groupId, didHash(aliceDid), didHash(aliceDid), ethers.id('commit-remove-owner')),
    ).to.be.revertedWithCustomError(registry, 'CannotRemoveOwner');
  });
});
