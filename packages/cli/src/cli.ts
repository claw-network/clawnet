#!/usr/bin/env node

import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ClawTokenNode,
  DEFAULT_P2P_SYNC_CONFIG,
  DEFAULT_SYNC_RUNTIME_CONFIG,
} from '@clawtoken/node';
import type { NodeRuntimeConfig } from '@clawtoken/node';
import {
  addressFromDid,
  bytesToUtf8,
  createKeyRecord,
  decryptKeyRecord,
  didFromPublicKey,
  ensureConfig,
  EventStore,
  EventEnvelope,
  generateMnemonic,
  hkdfSha256,
  keyIdFromPublicKey,
  loadConfig,
  loadKeyRecord,
  LevelStore,
  mnemonicToSeedSync,
  publicKeyFromDid,
  publicKeyFromPrivateKey,
  resolveStoragePaths,
  saveKeyRecord,
  utf8ToBytes,
  validateMnemonic,
  verifyCapabilityCredential,
} from '@clawtoken/core';
import {
  applyReputationEvent,
  applyWalletEvent,
  CapabilityCredential,
  buildReputationProfile,
  createIdentityCapabilityRegisterEnvelope,
  createReputationRecordEnvelope,
  createReputationState,
  createWalletEscrowCreateEnvelope,
  createWalletEscrowFundEnvelope,
  createWalletEscrowRefundEnvelope,
  createWalletEscrowReleaseEnvelope,
  createWalletTransferEnvelope,
  createWalletState,
  getWalletBalance,
  getReputationRecords,
  isReputationAspectKey,
  isReputationDimension,
  MemoryReputationStore,
  ReputationAspectKey,
  ReputationDimension,
  ReputationLevel,
  ReputationRecord,
  WalletState,
} from '@clawtoken/protocol';

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  const command = argv[0];
  if (!command || command === 'daemon' || command.startsWith('-')) {
    const node = new ClawTokenNode(parseDaemonArgs(argv));
    process.on('SIGINT', () => void shutdown(node, 'SIGINT'));
    process.on('SIGTERM', () => void shutdown(node, 'SIGTERM'));
    void node.start().catch((error) => {
      console.error('[clawtoken] failed to start:', error);
      process.exit(1);
    });
    return;
  }
  if (command === 'init') {
    await runInit(argv.slice(1));
    return;
  }
  if (command === 'status') {
    await runStatus(argv.slice(1));
    return;
  }
  if (command === 'peers') {
    await runPeers(argv.slice(1));
    return;
  }
  if (command === 'market') {
    const subcommand = argv[1];
    const subArgs = argv.slice(2);
    if (subcommand === 'info') {
      const action = subArgs[0];
      const actionArgs = subArgs.slice(1);
      if (action === 'list') {
        await runMarketInfoList(actionArgs);
        return;
      }
      if (action === 'get') {
        await runMarketInfoGet(actionArgs);
        return;
      }
      if (action === 'publish') {
        await runMarketInfoPublish(actionArgs);
        return;
      }
      if (action === 'purchase') {
        await runMarketInfoPurchase(actionArgs);
        return;
      }
      if (action === 'subscribe') {
        await runMarketInfoSubscribe(actionArgs);
        return;
      }
      if (action === 'unsubscribe') {
        await runMarketInfoUnsubscribe(actionArgs);
        return;
      }
      if (action === 'deliver') {
        await runMarketInfoDeliver(actionArgs);
        return;
      }
      if (action === 'confirm') {
        await runMarketInfoConfirm(actionArgs);
        return;
      }
      if (action === 'review') {
        await runMarketInfoReview(actionArgs);
        return;
      }
      if (action === 'remove') {
        await runMarketInfoRemove(actionArgs);
        return;
      }
      if (action === 'content') {
        await runMarketInfoContent(actionArgs);
        return;
      }
      if (action === 'delivery') {
        await runMarketInfoDelivery(actionArgs);
        return;
      }
      fail(`unknown market info command: ${action ?? ''}`);
    }
    if (subcommand === 'task') {
      const action = subArgs[0];
      const actionArgs = subArgs.slice(1);
      if (action === 'list') {
        await runMarketTaskList(actionArgs);
        return;
      }
      if (action === 'get') {
        await runMarketTaskGet(actionArgs);
        return;
      }
      if (action === 'publish') {
        await runMarketTaskPublish(actionArgs);
        return;
      }
      if (action === 'bids') {
        await runMarketTaskBids(actionArgs);
        return;
      }
      if (action === 'bid') {
        await runMarketTaskBid(actionArgs);
        return;
      }
      if (action === 'accept') {
        await runMarketTaskAccept(actionArgs);
        return;
      }
      if (action === 'reject') {
        await runMarketTaskReject(actionArgs);
        return;
      }
      if (action === 'withdraw') {
        await runMarketTaskWithdraw(actionArgs);
        return;
      }
      if (action === 'deliver') {
        await runMarketTaskDeliver(actionArgs);
        return;
      }
      if (action === 'confirm') {
        await runMarketTaskConfirm(actionArgs);
        return;
      }
      if (action === 'review') {
        await runMarketTaskReview(actionArgs);
        return;
      }
      if (action === 'remove') {
        await runMarketTaskRemove(actionArgs);
        return;
      }
      fail(`unknown market task command: ${action ?? ''}`);
    }
    if (subcommand === 'capability') {
      const action = subArgs[0];
      const actionArgs = subArgs.slice(1);
      if (action === 'list') {
        await runMarketCapabilityList(actionArgs);
        return;
      }
      if (action === 'get') {
        await runMarketCapabilityGet(actionArgs);
        return;
      }
      if (action === 'publish') {
        await runMarketCapabilityPublish(actionArgs);
        return;
      }
      if (action === 'lease') {
        await runMarketCapabilityLease(actionArgs);
        return;
      }
      if (action === 'lease-get') {
        await runMarketCapabilityLeaseGet(actionArgs);
        return;
      }
      if (action === 'invoke') {
        await runMarketCapabilityInvoke(actionArgs);
        return;
      }
      if (action === 'pause') {
        await runMarketCapabilityPause(actionArgs);
        return;
      }
      if (action === 'resume') {
        await runMarketCapabilityResume(actionArgs);
        return;
      }
      if (action === 'terminate') {
        await runMarketCapabilityTerminate(actionArgs);
        return;
      }
      if (action === 'remove') {
        await runMarketCapabilityRemove(actionArgs);
        return;
      }
      fail(`unknown market capability command: ${action ?? ''}`);
    }
    if (subcommand === 'dispute') {
      const action = subArgs[0];
      const actionArgs = subArgs.slice(1);
      if (action === 'open') {
        await runMarketDisputeOpen(actionArgs);
        return;
      }
      if (action === 'respond') {
        await runMarketDisputeRespond(actionArgs);
        return;
      }
      if (action === 'resolve') {
        await runMarketDisputeResolve(actionArgs);
        return;
      }
      fail(`unknown market dispute command: ${action ?? ''}`);
    }
    fail(`unknown market subcommand: ${subcommand ?? ''}`);
  }
  if (command === 'contract') {
    const subcommand = argv[1];
    const subArgs = argv.slice(2);
    if (subcommand === 'list') {
      await runContractList(subArgs);
      return;
    }
    if (subcommand === 'get') {
      await runContractGet(subArgs);
      return;
    }
    if (subcommand === 'create') {
      await runContractCreate(subArgs);
      return;
    }
    if (subcommand === 'sign') {
      await runContractSign(subArgs);
      return;
    }
    if (subcommand === 'fund') {
      await runContractFund(subArgs);
      return;
    }
    if (subcommand === 'complete') {
      await runContractComplete(subArgs);
      return;
    }
    if (subcommand === 'milestone-complete') {
      await runContractMilestoneComplete(subArgs);
      return;
    }
    if (subcommand === 'milestone-approve') {
      await runContractMilestoneApprove(subArgs);
      return;
    }
    if (subcommand === 'milestone-reject') {
      await runContractMilestoneReject(subArgs);
      return;
    }
    if (subcommand === 'dispute') {
      await runContractDisputeOpen(subArgs);
      return;
    }
    if (subcommand === 'dispute-resolve') {
      await runContractDisputeResolve(subArgs);
      return;
    }
    if (subcommand === 'settlement') {
      await runContractSettlementExecute(subArgs);
      return;
    }
    fail(`unknown contract subcommand: ${subcommand ?? ''}`);
  }
  if (command === 'identity') {
    const subcommand = argv[1];
    const subArgs = argv.slice(2);
    if (subcommand === 'capability-register') {
      await runCapabilityRegister(subArgs);
      return;
    }
    fail(`unknown identity subcommand: ${subcommand ?? ''}`);
  }
  if (command === 'balance') {
    await runBalance(argv.slice(1));
    return;
  }
  if (command === 'transfer') {
    await runTransfer(argv.slice(1));
    return;
  }
  if (command === 'logs') {
    await runLogs(argv.slice(1));
    return;
  }
  if (command === 'reputation') {
    const subcommand = argv[1];
    const subArgs = argv.slice(2);
    if (subcommand === 'record') {
      await runReputationRecord(subArgs);
      return;
    }
    if (subcommand === 'reviews') {
      await runReputationReviews(subArgs);
      return;
    }
    await runReputation(argv.slice(1));
    return;
  }
  if (command === 'escrow') {
    const subcommand = argv[1];
    const subArgs = argv.slice(2);
    if (subcommand === 'create') {
      await runEscrowCreate(subArgs);
      return;
    }
    if (subcommand === 'fund') {
      await runEscrowFund(subArgs);
      return;
    }
    if (subcommand === 'release') {
      await runEscrowRelease(subArgs);
      return;
    }
    if (subcommand === 'refund') {
      await runEscrowRefund(subArgs);
      return;
    }
    if (subcommand === 'expire') {
      await runEscrowExpire(subArgs);
      return;
    }
    fail(`unknown escrow subcommand: ${subcommand ?? ''}`);
  }
  if (command === 'dao') {
    const subcommand = argv[1];
    const subArgs = argv.slice(2);
    if (subcommand === 'proposals') {
      await runDaoProposals(subArgs);
      return;
    }
    if (subcommand === 'proposal') {
      await runDaoProposal(subArgs);
      return;
    }
    if (subcommand === 'create-proposal') {
      await runDaoCreateProposal(subArgs);
      return;
    }
    if (subcommand === 'advance') {
      await runDaoAdvanceProposal(subArgs);
      return;
    }
    if (subcommand === 'vote') {
      await runDaoVote(subArgs);
      return;
    }
    if (subcommand === 'votes') {
      await runDaoVotes(subArgs);
      return;
    }
    if (subcommand === 'delegate') {
      await runDaoDelegate(subArgs);
      return;
    }
    if (subcommand === 'revoke-delegation') {
      await runDaoRevokeDelegation(subArgs);
      return;
    }
    if (subcommand === 'delegations') {
      await runDaoDelegations(subArgs);
      return;
    }
    if (subcommand === 'treasury') {
      await runDaoTreasury(subArgs);
      return;
    }
    if (subcommand === 'deposit') {
      await runDaoDeposit(subArgs);
      return;
    }
    if (subcommand === 'timelock') {
      await runDaoTimelock(subArgs);
      return;
    }
    if (subcommand === 'execute') {
      await runDaoTimelockExecute(subArgs);
      return;
    }
    if (subcommand === 'cancel') {
      await runDaoTimelockCancel(subArgs);
      return;
    }
    if (subcommand === 'params') {
      await runDaoParams(subArgs);
      return;
    }
    fail(`unknown dao subcommand: ${subcommand ?? ''}`);
  }
  fail(`unknown command: ${command}`);
}

async function shutdown(node: ClawTokenNode, signal: string): Promise<void> {
  console.log(`[clawtoken] received ${signal}, stopping...`);
  await node.stop();
  process.exit(0);
}

async function runInit(rawArgs: string[]): Promise<void> {
  const parsed = parseInitArgs(rawArgs);
  const paths = resolveStoragePaths(parsed.dataDir);
  await ensureConfig(paths);

  const mnemonic = parsed.mnemonic ?? generateMnemonic(parsed.strength ?? 256);
  if (!validateMnemonic(mnemonic)) {
    fail('invalid mnemonic');
  }
  const seed = mnemonicToSeedSync(mnemonic, parsed.mnemonicPassphrase ?? '');
  const privateKey = hkdfSha256(seed, undefined, utf8ToBytes('clawtoken:master:v1'), 32);
  const publicKey = await publicKeyFromPrivateKey(privateKey);
  const did = didFromPublicKey(publicKey);

  try {
    const record = createKeyRecord(publicKey, privateKey, parsed.passphrase);
    await saveKeyRecord(paths, record);
  } catch (error) {
    fail((error as Error).message);
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('ClawToken Node 初始化');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✓ 生成密钥对');
  console.log(`✓ 创建 DID: ${did}`);
  console.log(`✓ 配置保存到 ${paths.configFile}`);
  console.log(`✓ 私钥加密保存到 ${paths.keys}`);
  console.log('');
  console.log('⚠️  请备份助记词:');
  console.log(`   ${mnemonic}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

async function runStatus(rawArgs: string[]): Promise<void> {
  const parsed = parseApiArgs(rawArgs);
  const data = await fetchApiJson(parsed.apiUrl, '/api/node/status', parsed.token);
  console.log(JSON.stringify(data, null, 2));
}

async function runPeers(rawArgs: string[]): Promise<void> {
  const parsed = parseApiArgs(rawArgs);
  const data = await fetchApiJson(parsed.apiUrl, '/api/node/peers', parsed.token);
  console.log(JSON.stringify(data, null, 2));
}

async function runMarketInfoList(rawArgs: string[]): Promise<void> {
  const parsed = parseApiArgsWithQuery(rawArgs);
  const query = parsed.query ? `?${parsed.query.replace(/^\?/, '')}` : '';
  const data = await fetchApiJson(parsed.apiUrl, `/api/markets/info${query}`, parsed.token);
  console.log(JSON.stringify(data, null, 2));
}

async function runMarketInfoGet(rawArgs: string[]): Promise<void> {
  const { apiArgs, rest } = splitApiArgs(rawArgs);
  const parsed = parseApiArgs(apiArgs);
  const listingId = rest[0];
  if (!listingId) {
    fail('missing <listingId>');
  }
  const data = await fetchApiJson(
    parsed.apiUrl,
    `/api/markets/info/${encodeURIComponent(listingId)}`,
    parsed.token,
  );
  console.log(JSON.stringify(data, null, 2));
}

async function runMarketInfoContent(rawArgs: string[]): Promise<void> {
  const { apiArgs, rest } = splitApiArgs(rawArgs);
  const parsed = parseApiArgs(apiArgs);
  const listingId = rest[0];
  if (!listingId) {
    fail('missing <listingId>');
  }
  const data = await fetchApiJson(
    parsed.apiUrl,
    `/api/markets/info/${encodeURIComponent(listingId)}/content`,
    parsed.token,
  );
  console.log(JSON.stringify(data, null, 2));
}

async function runMarketInfoDelivery(rawArgs: string[]): Promise<void> {
  const { apiArgs, rest } = splitApiArgs(rawArgs);
  const parsed = parseApiArgs(apiArgs);
  const orderId = rest[0];
  if (!orderId) {
    fail('missing <orderId>');
  }
  const data = await fetchApiJson(
    parsed.apiUrl,
    `/api/markets/info/orders/${encodeURIComponent(orderId)}/delivery`,
    parsed.token,
  );
  console.log(JSON.stringify(data, null, 2));
}

async function runMarketInfoPublish(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data } = await parseApiArgsWithData(rawArgs);
  const response = await fetchApiJsonWithBody(apiUrl, '/api/markets/info', 'POST', data, token);
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketInfoPurchase(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const listingId = rest[0];
  if (!listingId) {
    fail('missing <listingId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/info/${encodeURIComponent(listingId)}/purchase`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketInfoSubscribe(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const listingId = rest[0];
  if (!listingId) {
    fail('missing <listingId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/info/${encodeURIComponent(listingId)}/subscribe`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketInfoUnsubscribe(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const subscriptionId = rest[0];
  if (!subscriptionId) {
    fail('missing <subscriptionId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/info/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketInfoDeliver(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const listingId = rest[0];
  if (!listingId) {
    fail('missing <listingId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/info/${encodeURIComponent(listingId)}/deliver`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketInfoConfirm(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const listingId = rest[0];
  if (!listingId) {
    fail('missing <listingId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/info/${encodeURIComponent(listingId)}/confirm`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketInfoReview(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const listingId = rest[0];
  if (!listingId) {
    fail('missing <listingId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/info/${encodeURIComponent(listingId)}/review`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketInfoRemove(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const listingId = rest[0];
  if (!listingId) {
    fail('missing <listingId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/info/${encodeURIComponent(listingId)}/remove`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketTaskList(rawArgs: string[]): Promise<void> {
  const parsed = parseApiArgsWithQuery(rawArgs);
  const query = parsed.query ? `?${parsed.query.replace(/^\?/, '')}` : '';
  const data = await fetchApiJson(parsed.apiUrl, `/api/markets/tasks${query}`, parsed.token);
  console.log(JSON.stringify(data, null, 2));
}

async function runMarketTaskGet(rawArgs: string[]): Promise<void> {
  const { apiArgs, rest } = splitApiArgs(rawArgs);
  const parsed = parseApiArgs(apiArgs);
  const taskId = rest[0];
  if (!taskId) {
    fail('missing <taskId>');
  }
  const data = await fetchApiJson(
    parsed.apiUrl,
    `/api/markets/tasks/${encodeURIComponent(taskId)}`,
    parsed.token,
  );
  console.log(JSON.stringify(data, null, 2));
}

async function runMarketTaskBids(rawArgs: string[]): Promise<void> {
  const { apiArgs, rest } = splitApiArgs(rawArgs);
  const parsed = parseApiArgs(apiArgs);
  const taskId = rest[0];
  if (!taskId) {
    fail('missing <taskId>');
  }
  let query = '';
  if (rest[1] === '--query') {
    query = rest[2] ?? '';
  } else if (rest[1] && !rest[1].startsWith('-')) {
    query = rest[1];
  }
  const suffix = query ? `?${query.replace(/^\\?/, '')}` : '';
  const data = await fetchApiJson(
    parsed.apiUrl,
    `/api/markets/tasks/${encodeURIComponent(taskId)}/bids${suffix}`,
    parsed.token,
  );
  console.log(JSON.stringify(data, null, 2));
}

async function runMarketTaskPublish(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data } = await parseApiArgsWithData(rawArgs);
  const response = await fetchApiJsonWithBody(apiUrl, '/api/markets/tasks', 'POST', data, token);
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketTaskBid(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const taskId = rest[0];
  if (!taskId) {
    fail('missing <taskId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/tasks/${encodeURIComponent(taskId)}/bids`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketTaskAccept(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const taskId = rest[0];
  if (!taskId) {
    fail('missing <taskId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/tasks/${encodeURIComponent(taskId)}/accept`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketTaskReject(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const taskId = rest[0];
  if (!taskId) {
    fail('missing <taskId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/tasks/${encodeURIComponent(taskId)}/reject`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketTaskWithdraw(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const taskId = rest[0];
  if (!taskId) {
    fail('missing <taskId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/tasks/${encodeURIComponent(taskId)}/withdraw`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketTaskDeliver(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const taskId = rest[0];
  if (!taskId) {
    fail('missing <taskId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/tasks/${encodeURIComponent(taskId)}/deliver`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketTaskConfirm(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const taskId = rest[0];
  if (!taskId) {
    fail('missing <taskId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/tasks/${encodeURIComponent(taskId)}/confirm`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketTaskReview(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const taskId = rest[0];
  if (!taskId) {
    fail('missing <taskId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/tasks/${encodeURIComponent(taskId)}/review`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketTaskRemove(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const taskId = rest[0];
  if (!taskId) {
    fail('missing <taskId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/tasks/${encodeURIComponent(taskId)}/remove`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketCapabilityList(rawArgs: string[]): Promise<void> {
  const parsed = parseApiArgsWithQuery(rawArgs);
  const query = parsed.query ? `?${parsed.query.replace(/^\?/, '')}` : '';
  const data = await fetchApiJson(parsed.apiUrl, `/api/markets/capabilities${query}`, parsed.token);
  console.log(JSON.stringify(data, null, 2));
}

async function runMarketCapabilityGet(rawArgs: string[]): Promise<void> {
  const { apiArgs, rest } = splitApiArgs(rawArgs);
  const parsed = parseApiArgs(apiArgs);
  const listingId = rest[0];
  if (!listingId) {
    fail('missing <listingId>');
  }
  const data = await fetchApiJson(
    parsed.apiUrl,
    `/api/markets/capabilities/${encodeURIComponent(listingId)}`,
    parsed.token,
  );
  console.log(JSON.stringify(data, null, 2));
}

async function runMarketCapabilityRemove(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const listingId = rest[0];
  if (!listingId) {
    fail('missing <listingId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/capabilities/${encodeURIComponent(listingId)}/remove`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketCapabilityPublish(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data } = await parseApiArgsWithData(rawArgs);
  const response = await fetchApiJsonWithBody(apiUrl, '/api/markets/capabilities', 'POST', data, token);
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketCapabilityLease(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const listingId = rest[0];
  if (!listingId) {
    fail('missing <listingId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/capabilities/${encodeURIComponent(listingId)}/lease`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketCapabilityLeaseGet(rawArgs: string[]): Promise<void> {
  const { apiArgs, rest } = splitApiArgs(rawArgs);
  const parsed = parseApiArgs(apiArgs);
  const leaseId = rest[0];
  if (!leaseId) {
    fail('missing <leaseId>');
  }
  const data = await fetchApiJson(
    parsed.apiUrl,
    `/api/markets/capabilities/leases/${encodeURIComponent(leaseId)}`,
    parsed.token,
  );
  console.log(JSON.stringify(data, null, 2));
}

async function runMarketCapabilityInvoke(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const leaseId = rest[0];
  if (!leaseId) {
    fail('missing <leaseId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/capabilities/leases/${encodeURIComponent(leaseId)}/invoke`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketCapabilityPause(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const leaseId = rest[0];
  if (!leaseId) {
    fail('missing <leaseId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/capabilities/leases/${encodeURIComponent(leaseId)}/pause`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketCapabilityResume(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const leaseId = rest[0];
  if (!leaseId) {
    fail('missing <leaseId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/capabilities/leases/${encodeURIComponent(leaseId)}/resume`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketCapabilityTerminate(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const leaseId = rest[0];
  if (!leaseId) {
    fail('missing <leaseId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/capabilities/leases/${encodeURIComponent(leaseId)}/terminate`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketDisputeOpen(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const orderId = rest[0];
  if (!orderId) {
    fail('missing <orderId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/orders/${encodeURIComponent(orderId)}/dispute`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketDisputeRespond(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const disputeId = rest[0];
  if (!disputeId) {
    fail('missing <disputeId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/disputes/${encodeURIComponent(disputeId)}/respond`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runMarketDisputeResolve(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const disputeId = rest[0];
  if (!disputeId) {
    fail('missing <disputeId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/markets/disputes/${encodeURIComponent(disputeId)}/resolve`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runContractList(rawArgs: string[]): Promise<void> {
  const parsed = parseApiArgsWithQuery(rawArgs);
  const query = parsed.query ? `?${parsed.query.replace(/^\?/, '')}` : '';
  const data = await fetchApiJson(parsed.apiUrl, `/api/contracts${query}`, parsed.token);
  console.log(JSON.stringify(data, null, 2));
}

async function runContractGet(rawArgs: string[]): Promise<void> {
  const { apiArgs, rest } = splitApiArgs(rawArgs);
  const parsed = parseApiArgs(apiArgs);
  const contractId = rest[0];
  if (!contractId) {
    fail('missing <contractId>');
  }
  const data = await fetchApiJson(
    parsed.apiUrl,
    `/api/contracts/${encodeURIComponent(contractId)}`,
    parsed.token,
  );
  console.log(JSON.stringify(data, null, 2));
}

async function runContractCreate(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data } = await parseApiArgsWithData(rawArgs);
  const response = await fetchApiJsonWithBody(apiUrl, '/api/contracts', 'POST', data, token);
  console.log(JSON.stringify(response, null, 2));
}

async function runContractSign(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const contractId = rest[0];
  if (!contractId) {
    fail('missing <contractId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/contracts/${encodeURIComponent(contractId)}/sign`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runContractFund(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const contractId = rest[0];
  if (!contractId) {
    fail('missing <contractId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/contracts/${encodeURIComponent(contractId)}/fund`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runContractComplete(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const contractId = rest[0];
  if (!contractId) {
    fail('missing <contractId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/contracts/${encodeURIComponent(contractId)}/complete`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runContractMilestoneComplete(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const contractId = rest[0];
  const milestoneId = rest[1];
  if (!contractId || !milestoneId) {
    fail('missing <contractId> <milestoneId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/contracts/${encodeURIComponent(contractId)}/milestones/${encodeURIComponent(milestoneId)}/complete`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runContractMilestoneApprove(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const contractId = rest[0];
  const milestoneId = rest[1];
  if (!contractId || !milestoneId) {
    fail('missing <contractId> <milestoneId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/contracts/${encodeURIComponent(contractId)}/milestones/${encodeURIComponent(milestoneId)}/approve`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runContractMilestoneReject(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const contractId = rest[0];
  const milestoneId = rest[1];
  if (!contractId || !milestoneId) {
    fail('missing <contractId> <milestoneId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/contracts/${encodeURIComponent(contractId)}/milestones/${encodeURIComponent(milestoneId)}/reject`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runContractDisputeOpen(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const contractId = rest[0];
  if (!contractId) {
    fail('missing <contractId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/contracts/${encodeURIComponent(contractId)}/dispute`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runContractDisputeResolve(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const contractId = rest[0];
  if (!contractId) {
    fail('missing <contractId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/contracts/${encodeURIComponent(contractId)}/dispute/resolve`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runContractSettlementExecute(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const contractId = rest[0];
  if (!contractId) {
    fail('missing <contractId>');
  }
  const response = await fetchApiJsonWithBody(
    apiUrl,
    `/api/contracts/${encodeURIComponent(contractId)}/settlement`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(response, null, 2));
}

async function runCapabilityRegister(rawArgs: string[]): Promise<void> {
  const parsed = parseCapabilityRegisterArgs(rawArgs);
  const credentialRaw = await readFile(parsed.credentialPath, 'utf8');
  const credential = JSON.parse(credentialRaw) as CapabilityCredential;
  if (!credential?.credentialSubject) {
    fail('invalid credential JSON');
  }
  if (!(await verifyCapabilityCredential(credential))) {
    fail('credential proof or issuer invalid');
  }

  const subject = credential.credentialSubject;
  if (!subject?.name || !subject?.pricing) {
    fail('credential subject missing name or pricing');
  }

  const paths = resolveStoragePaths(parsed.dataDir);
  const record = await loadKeyRecord(paths, parsed.keyId);
  const privateKey = await decryptKeyRecord(record, parsed.passphrase);
  const derivedDid = didFromPublicKey(await publicKeyFromPrivateKey(privateKey));
  if (derivedDid !== parsed.did) {
    fail('private key does not match did');
  }

  const envelope = await createIdentityCapabilityRegisterEnvelope({
    did: parsed.did,
    privateKey,
    name: subject.name,
    pricing: subject.pricing,
    description: subject.description,
    credential,
    ts: parsed.ts ?? Date.now(),
    nonce: parsed.nonce,
    prev: parsed.prev,
  });

  const node = new ClawTokenNode(parsed.nodeConfig);
  try {
    await node.start();
    const hash = await node.publishEvent(envelope);
    console.log(`[clawtoken] published identity.capability.register ${hash}`);
  } finally {
    await node.stop();
  }
}

async function runBalance(rawArgs: string[]): Promise<void> {
  const parsed = parseBalanceArgs(rawArgs);
  const target = parsed.address ?? addressFromDid(parsed.did);
  const paths = resolveStoragePaths(parsed.dataDir);
  const store = new LevelStore({ path: paths.eventsDb });
  const eventStore = new EventStore(store);
  try {
    const state = await buildWalletState(eventStore);
    const balance = getWalletBalance(state, target);
    const total =
      BigInt(balance.available) +
      BigInt(balance.pending) +
      BigInt(balance.locked.escrow) +
      BigInt(balance.locked.governance);
    console.log(
      JSON.stringify(
        {
          address: target,
          balance: total.toString(),
          available: balance.available,
          pending: balance.pending,
          locked: balance.locked.escrow,
        },
        null,
        2,
      ),
    );
  } finally {
    await store.close();
  }
}

async function runLogs(rawArgs: string[]): Promise<void> {
  const parsed = parseLogsArgs(rawArgs);
  const logFile = parsed.file ?? (await resolveLogFile(parsed.dataDir));
  if (!logFile) {
    fail('log file not configured');
  }
  const content = await readFile(logFile, 'utf8').catch((error) => {
    fail(`failed to read log file: ${(error as Error).message}`);
  });
  process.stdout.write(content ?? '');
  if (!parsed.follow) {
    return;
  }
  let position = 0;
  try {
    const stats = await stat(logFile);
    position = stats.size;
  } catch {
    position = 0;
  }
  const { watch } = await import('node:fs');
  const watcher = watch(logFile, async (event) => {
    if (event !== 'change') {
      return;
    }
    try {
      const stats = await stat(logFile);
      if (stats.size <= position) {
        return;
      }
      const data = await readFile(logFile, 'utf8');
      const chunk = data.slice(position);
      position = stats.size;
      process.stdout.write(chunk);
    } catch {
      return;
    }
  });
  process.on('SIGINT', () => watcher.close());
  process.on('SIGTERM', () => watcher.close());
}

async function runReputation(rawArgs: string[]): Promise<void> {
  const parsed = parseReputationArgs(rawArgs);
  const paths = resolveStoragePaths(parsed.dataDir);
  const store = new LevelStore({ path: paths.eventsDb });
  const eventStore = new EventStore(store);
  try {
    if (parsed.source === 'store') {
      const reputationStore = await buildReputationStore(eventStore);
      const records = await reputationStore.getRecords(parsed.did);
      if (!records.length) {
        fail('reputation not found');
      }
      const profile = await reputationStore.getProfile(parsed.did);
      const levelInfo = mapReputationLevel(profile.level);
      const qualityRecords = records.filter((record) => record.dimension === 'quality');
      const averageRating = computeAverageRating(qualityRecords);
      console.log(
        JSON.stringify(
          {
            did: parsed.did,
            score: profile.overallScore,
            level: levelInfo.label,
            levelNumber: levelInfo.levelNumber,
            dimensions: {
              transaction: profile.dimensions.transaction.score,
              delivery: profile.dimensions.fulfillment.score,
              quality: profile.dimensions.quality.score,
              social: profile.dimensions.social.score,
              behavior: profile.dimensions.behavior.score,
            },
            totalTransactions: profile.dimensions.transaction.recordCount,
            successRate: 0,
            averageRating,
            badges: [],
            updatedAt: profile.updatedAt ?? Date.now(),
          },
          null,
          2,
        ),
      );
      return;
    }

    const state = await buildReputationState(eventStore);
    const records = getReputationRecords(state, parsed.did);
    if (!records.length) {
      fail('reputation not found');
    }
    const profile = buildReputationProfile(state, parsed.did);
    const levelInfo = mapReputationLevel(profile.level);
    const qualityRecords = records.filter((record) => record.dimension === 'quality');
    const averageRating = computeAverageRating(qualityRecords);
    console.log(
      JSON.stringify(
        {
          did: parsed.did,
          score: profile.overallScore,
          level: levelInfo.label,
          levelNumber: levelInfo.levelNumber,
          dimensions: {
            transaction: profile.dimensions.transaction.score,
            delivery: profile.dimensions.fulfillment.score,
            quality: profile.dimensions.quality.score,
            social: profile.dimensions.social.score,
            behavior: profile.dimensions.behavior.score,
          },
          totalTransactions: profile.dimensions.transaction.recordCount,
          successRate: 0,
          averageRating,
          badges: [],
          updatedAt: profile.updatedAt ?? Date.now(),
        },
        null,
        2,
      ),
    );
  } finally {
    await store.close();
  }
}

async function runReputationReviews(rawArgs: string[]): Promise<void> {
  const parsed = parseReputationReviewsArgs(rawArgs);
  const paths = resolveStoragePaths(parsed.dataDir);
  const store = new LevelStore({ path: paths.eventsDb });
  const eventStore = new EventStore(store);
  try {
    if (parsed.source === 'store') {
      const reputationStore = await buildReputationStore(eventStore);
      const allRecords = await reputationStore.getRecords(parsed.did);
      if (!allRecords.length) {
        fail('reputation not found');
      }
      const records = allRecords.filter((record) => record.dimension === 'quality');
      const sorted = [...records].sort((a, b) => b.ts - a.ts);
      const sliced = sorted.slice(parsed.offset, parsed.offset + parsed.limit);
      const reviews = sliced.map((record) => ({
        id: record.hash,
        contractId: record.ref,
        reviewer: record.issuer,
        reviewee: record.target,
        rating: ratingFromScore(record.score),
        comment: record.comment,
        aspects: record.aspects,
        createdAt: record.ts,
      }));
      const averageRating = computeAverageRating(records);
      console.log(
        JSON.stringify(
          {
            reviews,
            total: records.length,
            averageRating,
            pagination: {
              total: records.length,
              limit: parsed.limit,
              offset: parsed.offset,
              hasMore: parsed.offset + parsed.limit < records.length,
            },
          },
          null,
          2,
        ),
      );
      return;
    }

    const state = await buildReputationState(eventStore);
    const allRecords = getReputationRecords(state, parsed.did);
    if (!allRecords.length) {
      fail('reputation not found');
    }
    const records = allRecords.filter((record) => record.dimension === 'quality');
    const sorted = [...records].sort((a, b) => b.ts - a.ts);
    const sliced = sorted.slice(parsed.offset, parsed.offset + parsed.limit);
    const reviews = sliced.map((record) => ({
      id: record.hash,
      contractId: record.ref,
      reviewer: record.issuer,
      reviewee: record.target,
      rating: ratingFromScore(record.score),
      comment: record.comment,
      aspects: record.aspects,
      createdAt: record.ts,
    }));
    const averageRating = computeAverageRating(records);
    console.log(
      JSON.stringify(
        {
          reviews,
          total: records.length,
          averageRating,
          pagination: {
            total: records.length,
            limit: parsed.limit,
            offset: parsed.offset,
            hasMore: parsed.offset + parsed.limit < records.length,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await store.close();
  }
}

async function runReputationRecord(
  rawArgs: string[],
  deps: { createNode?: NodeFactory } = {},
): Promise<void> {
  const parsed = parseReputationRecordArgs(rawArgs);
  const keyId =
    parsed.keyId && parsed.keyId.length > 0
      ? parsed.keyId
      : keyIdFromPublicKey(publicKeyFromDid(parsed.did));
  const privateKey = await resolvePrivateKey(parsed.dataDir, keyId, parsed.passphrase);
  const derivedDid = didFromPublicKey(await publicKeyFromPrivateKey(privateKey));
  if (derivedDid !== parsed.did) {
    fail('private key does not match did');
  }

  const envelope = await createReputationRecordEnvelope({
    issuer: parsed.did,
    privateKey,
    target: parsed.target,
    dimension: parsed.dimension,
    score: parsed.score,
    ref: parsed.ref,
    comment: parsed.comment,
    aspects: parsed.aspects,
    ts: parsed.ts ?? Date.now(),
    nonce: parsed.nonce,
    prev: parsed.prev,
  });

  const node = (deps.createNode ?? defaultNodeFactory)(parsed.nodeConfig);
  try {
    await node.start();
    const hash = await node.publishEvent(envelope);
    console.log(`[clawtoken] published reputation.record ${hash}`);
  } finally {
    await node.stop();
  }
}

type NodeFactory = (config?: NodeRuntimeConfig) => {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  publishEvent: (envelope: Record<string, unknown>) => Promise<string>;
};

const defaultNodeFactory: NodeFactory = (config) => new ClawTokenNode(config);

interface InitArgs {
  passphrase: string;
  dataDir?: string;
  mnemonic?: string;
  mnemonicPassphrase?: string;
  strength?: number;
}

interface ApiArgs {
  apiUrl: string;
  token?: string;
}

interface LogsArgs {
  dataDir?: string;
  file?: string;
  follow: boolean;
}

type ReputationSource = 'log' | 'store';

interface ReputationArgs {
  did: string;
  dataDir?: string;
  source: ReputationSource;
}

interface ReputationReviewsArgs extends ReputationArgs {
  limit: number;
  offset: number;
}

interface ReputationRecordArgs {
  did: string;
  passphrase: string;
  keyId: string;
  target: string;
  dimension: ReputationDimension;
  score: number;
  ref: string;
  comment?: string;
  aspects?: Record<ReputationAspectKey, number>;
  nonce: number;
  prev?: string;
  ts?: number;
  dataDir?: string;
  nodeConfig: NodeRuntimeConfig;
}

function parseInitArgs(rawArgs: string[]): InitArgs {
  let passphrase = '';
  let dataDir: string | undefined;
  let mnemonic: string | undefined;
  let mnemonicPassphrase: string | undefined;
  let strength: number | undefined;

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--passphrase') {
      passphrase = rawArgs[++i] ?? '';
      continue;
    }
    if (arg === '--data-dir') {
      dataDir = rawArgs[++i];
      continue;
    }
    if (arg === '--mnemonic') {
      mnemonic = rawArgs[++i];
      continue;
    }
    if (arg === '--mnemonic-passphrase') {
      mnemonicPassphrase = rawArgs[++i];
      continue;
    }
    if (arg === '--strength') {
      strength = parsePositiveInt(rawArgs[++i], '--strength');
      continue;
    }
    fail(`unknown init option: ${arg}`);
  }

  if (!passphrase) {
    fail('missing --passphrase');
  }
  return {
    passphrase,
    dataDir,
    mnemonic,
    mnemonicPassphrase,
    strength,
  };
}

function parseApiArgs(rawArgs: string[]): ApiArgs {
  let apiUrl = 'http://127.0.0.1:9528';
  let token: string | undefined;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--api' || arg === '--api-url') {
      apiUrl = rawArgs[++i] ?? apiUrl;
      continue;
    }
    if (arg === '--token') {
      token = rawArgs[++i];
      continue;
    }
    fail(`unknown option: ${arg}`);
  }
  return { apiUrl, token };
}

function splitApiArgs(rawArgs: string[]): { apiArgs: string[]; rest: string[] } {
  const apiArgs: string[] = [];
  const rest: string[] = [];
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--api' || arg === '--api-url' || arg === '--token') {
      apiArgs.push(arg);
      apiArgs.push(rawArgs[++i] ?? '');
      continue;
    }
    rest.push(arg);
  }
  return { apiArgs, rest };
}

async function parseApiArgsWithData(
  rawArgs: string[],
): Promise<{ apiUrl: string; token?: string; data: Record<string, unknown>; rest: string[] }> {
  const apiArgs: string[] = [];
  const rest: string[] = [];
  let dataRaw: string | undefined;
  let dataFile: string | undefined;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--api' || arg === '--api-url' || arg === '--token') {
      apiArgs.push(arg);
      apiArgs.push(rawArgs[++i] ?? '');
      continue;
    }
    if (arg === '--data') {
      dataRaw = rawArgs[++i];
      continue;
    }
    if (arg === '--data-file') {
      dataFile = rawArgs[++i];
      continue;
    }
    rest.push(arg);
  }
  const { apiUrl, token } = parseApiArgs(apiArgs);
  let payloadText: string | undefined = dataRaw;
  if (!payloadText && dataFile) {
    payloadText = await readFile(dataFile, 'utf8');
  }
  if (!payloadText) {
    fail('missing --data or --data-file');
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payloadText) as Record<string, unknown>;
  } catch (error) {
    fail(`invalid JSON payload: ${(error as Error).message}`);
  }
  return { apiUrl, token, data, rest };
}

function parseApiArgsWithQuery(
  rawArgs: string[],
): { apiUrl: string; token?: string; query: string } {
  const apiArgs: string[] = [];
  let query = '';
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--api' || arg === '--api-url' || arg === '--token') {
      apiArgs.push(arg);
      apiArgs.push(rawArgs[++i] ?? '');
      continue;
    }
    if (arg === '--query') {
      query = rawArgs[++i] ?? '';
      continue;
    }
    if (!query && !arg.startsWith('-')) {
      query = arg;
      continue;
    }
    console.warn(`[clawtoken] unknown argument: ${arg}`);
  }
  const { apiUrl, token } = parseApiArgs(apiArgs);
  return { apiUrl, token, query };
}

function parseLogsArgs(rawArgs: string[]): LogsArgs {
  let dataDir: string | undefined;
  let file: string | undefined;
  let follow = false;
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--data-dir': {
        dataDir = rawArgs[++i];
        break;
      }
      case '--file': {
        file = rawArgs[++i];
        break;
      }
      case '--follow':
      case '-f': {
        follow = true;
        break;
      }
      default: {
        console.warn(`[clawtoken] unknown argument: ${arg}`);
        break;
      }
    }
  }
  return { dataDir, file, follow };
}

function parseReputationArgs(rawArgs: string[]): ReputationArgs {
  let did: string | undefined;
  let dataDir: string | undefined;
  let source: ReputationSource = 'log';

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--did') {
      did = rawArgs[++i];
      continue;
    }
    if (arg === '--data-dir') {
      dataDir = rawArgs[++i];
      continue;
    }
    if (arg === '--source') {
      const value = rawArgs[++i];
      if (value === 'log' || value === 'store') {
        source = value;
      } else {
        fail(`invalid --source: ${value ?? ''}`);
      }
      continue;
    }
    if (!arg.startsWith('-') && !did) {
      did = arg;
      continue;
    }
    console.warn(`[clawtoken] unknown argument: ${arg}`);
  }

  if (!did) {
    fail('missing --did');
  }

  return { did, dataDir, source };
}

function parseReputationReviewsArgs(rawArgs: string[]): ReputationReviewsArgs {
  let did: string | undefined;
  let dataDir: string | undefined;
  let limit = 20;
  let offset = 0;
  let source: ReputationSource = 'log';

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--did') {
      did = rawArgs[++i];
      continue;
    }
    if (arg === '--data-dir') {
      dataDir = rawArgs[++i];
      continue;
    }
    if (arg === '--source') {
      const value = rawArgs[++i];
      if (value === 'log' || value === 'store') {
        source = value;
      } else {
        fail(`invalid --source: ${value ?? ''}`);
      }
      continue;
    }
    if (arg === '--limit') {
      limit = parseNonNegativeInt(rawArgs[++i], '--limit');
      continue;
    }
    if (arg === '--offset') {
      offset = parseNonNegativeInt(rawArgs[++i], '--offset');
      continue;
    }
    if (!arg.startsWith('-') && !did) {
      did = arg;
      continue;
    }
    console.warn(`[clawtoken] unknown argument: ${arg}`);
  }

  if (!did) {
    fail('missing --did');
  }

  return { did, dataDir, limit, offset, source };
}

async function fetchApiJson(
  apiUrl: string,
  path: string,
  token?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${apiUrl}${path}`, { headers });
  const text = await res.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }
  if (!res.ok) {
    const error = payload.error as { code?: string; message?: string } | undefined;
    const code = error?.code ?? `HTTP_${res.status}`;
    const message = error?.message ?? res.statusText;
    fail(`API error ${code}: ${message}`);
  }
  return payload;
}

async function fetchApiJsonWithBody(
  apiUrl: string,
  path: string,
  method: 'POST' | 'PUT',
  body: Record<string, unknown>,
  token?: string,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }
  if (!res.ok) {
    const error = payload.error as { code?: string; message?: string } | undefined;
    const code = error?.code ?? `HTTP_${res.status}`;
    const message = error?.message ?? res.statusText;
    fail(`API error ${code}: ${message}`);
  }
  return payload;
}

async function resolveLogFile(dataDir?: string): Promise<string | null> {
  const paths = resolveStoragePaths(dataDir);
  try {
    const config = await loadConfig(paths);
    if (config.logging?.file) {
      return config.logging.file;
    }
  } catch {
    // ignore config load errors
  }
  return join(paths.logs, 'node.log');
}

async function runTransfer(
  rawArgs: string[],
  deps: { createNode?: NodeFactory } = {},
): Promise<void> {
  const parsed = parseTransferArgs(rawArgs);
  const keyId =
    parsed.keyId && parsed.keyId.length > 0
      ? parsed.keyId
      : keyIdFromPublicKey(publicKeyFromDid(parsed.did));
  const privateKey = await resolvePrivateKey(parsed.dataDir, keyId, parsed.passphrase);
  const derivedDid = didFromPublicKey(await publicKeyFromPrivateKey(privateKey));
  if (derivedDid !== parsed.did) {
    fail('private key does not match did');
  }
  const from = addressFromDid(parsed.did);
  const to = resolveAddress(parsed.to);
  if (!to) {
    fail('invalid --to');
  }

  const envelope = await createWalletTransferEnvelope({
    issuer: parsed.did,
    privateKey,
    from,
    to,
    amount: parsed.amount,
    fee: parsed.fee ?? '1',
    memo: parsed.memo,
    ts: parsed.ts ?? Date.now(),
    nonce: parsed.nonce,
    prev: parsed.prev,
  });

  const node = (deps.createNode ?? defaultNodeFactory)(parsed.nodeConfig);
  try {
    await node.start();
    const hash = await node.publishEvent(envelope);
    console.log(`[clawtoken] published wallet.transfer ${hash}`);
  } finally {
    await node.stop();
  }
}

async function runEscrowCreate(
  rawArgs: string[],
  deps: { createNode?: NodeFactory } = {},
): Promise<void> {
  const parsed = parseEscrowCreateArgs(rawArgs);
  const keyId =
    parsed.keyId && parsed.keyId.length > 0
      ? parsed.keyId
      : keyIdFromPublicKey(publicKeyFromDid(parsed.did));
  const privateKey = await resolvePrivateKey(parsed.dataDir, keyId, parsed.passphrase);
  const derivedDid = didFromPublicKey(await publicKeyFromPrivateKey(privateKey));
  if (derivedDid !== parsed.did) {
    fail('private key does not match did');
  }
  const depositor = addressFromDid(parsed.did);
  const beneficiary = resolveAddress(parsed.beneficiary);
  if (!beneficiary) {
    fail('invalid --beneficiary');
  }
  const escrowId = parsed.escrowId ?? `escrow-${Date.now()}`;
  const createEnvelope = await createWalletEscrowCreateEnvelope({
    issuer: parsed.did,
    privateKey,
    escrowId,
    depositor,
    beneficiary,
    amount: parsed.amount,
    releaseRules: parsed.releaseRules,
    resourcePrev: parsed.resourcePrev,
    arbiter: parsed.arbiter,
    refundRules: parsed.refundRules,
    expiresAt: parsed.expiresAt,
    ts: parsed.ts ?? Date.now(),
    nonce: parsed.nonce,
    prev: parsed.prev,
  });

  const node = (deps.createNode ?? defaultNodeFactory)(parsed.nodeConfig);
  try {
    await node.start();
    const hash = await node.publishEvent(createEnvelope);
    console.log(`[clawtoken] published wallet.escrow.create ${hash}`);
    if (parsed.autoFund) {
      const fundEnvelope = await createWalletEscrowFundEnvelope({
        issuer: parsed.did,
        privateKey,
        escrowId,
        resourcePrev: hash,
        amount: parsed.amount,
        ts: parsed.ts ?? Date.now(),
        nonce: parsed.nonce + 1,
        prev: hash,
      });
      const fundHash = await node.publishEvent(fundEnvelope);
      console.log(`[clawtoken] published wallet.escrow.fund ${fundHash}`);
    }
  } finally {
    await node.stop();
  }
}

async function runEscrowFund(
  rawArgs: string[],
  deps: { createNode?: NodeFactory } = {},
): Promise<void> {
  const parsed = parseEscrowActionArgs(rawArgs);
  const keyId =
    parsed.keyId && parsed.keyId.length > 0
      ? parsed.keyId
      : keyIdFromPublicKey(publicKeyFromDid(parsed.did));
  const privateKey = await resolvePrivateKey(parsed.dataDir, keyId, parsed.passphrase);
  const envelope = await createWalletEscrowFundEnvelope({
    issuer: parsed.did,
    privateKey,
    escrowId: parsed.escrowId,
    resourcePrev: parsed.resourcePrev,
    amount: parsed.amount,
    ts: parsed.ts ?? Date.now(),
    nonce: parsed.nonce,
    prev: parsed.prev,
  });

  const node = (deps.createNode ?? defaultNodeFactory)(parsed.nodeConfig);
  try {
    await node.start();
    const hash = await node.publishEvent(envelope);
    console.log(`[clawtoken] published wallet.escrow.fund ${hash}`);
  } finally {
    await node.stop();
  }
}

async function runEscrowRelease(
  rawArgs: string[],
  deps: { createNode?: NodeFactory } = {},
): Promise<void> {
  const parsed = parseEscrowActionArgs(rawArgs);
  if (!parsed.ruleId) {
    fail('missing --rule-id');
  }
  const keyId =
    parsed.keyId && parsed.keyId.length > 0
      ? parsed.keyId
      : keyIdFromPublicKey(publicKeyFromDid(parsed.did));
  const privateKey = await resolvePrivateKey(parsed.dataDir, keyId, parsed.passphrase);
  const envelope = await createWalletEscrowReleaseEnvelope({
    issuer: parsed.did,
    privateKey,
    escrowId: parsed.escrowId,
    resourcePrev: parsed.resourcePrev,
    amount: parsed.amount,
    ruleId: parsed.ruleId,
    ts: parsed.ts ?? Date.now(),
    nonce: parsed.nonce,
    prev: parsed.prev,
  });

  const node = (deps.createNode ?? defaultNodeFactory)(parsed.nodeConfig);
  try {
    await node.start();
    const hash = await node.publishEvent(envelope);
    console.log(`[clawtoken] published wallet.escrow.release ${hash}`);
  } finally {
    await node.stop();
  }
}

async function runEscrowRefund(
  rawArgs: string[],
  deps: { createNode?: NodeFactory } = {},
): Promise<void> {
  const parsed = parseEscrowActionArgs(rawArgs);
  if (!parsed.reason) {
    fail('missing --reason');
  }
  const keyId =
    parsed.keyId && parsed.keyId.length > 0
      ? parsed.keyId
      : keyIdFromPublicKey(publicKeyFromDid(parsed.did));
  const privateKey = await resolvePrivateKey(parsed.dataDir, keyId, parsed.passphrase);
  const envelope = await createWalletEscrowRefundEnvelope({
    issuer: parsed.did,
    privateKey,
    escrowId: parsed.escrowId,
    resourcePrev: parsed.resourcePrev,
    amount: parsed.amount,
    reason: parsed.reason,
    evidence: parsed.evidence,
    ts: parsed.ts ?? Date.now(),
    nonce: parsed.nonce,
    prev: parsed.prev,
  });

  const node = (deps.createNode ?? defaultNodeFactory)(parsed.nodeConfig);
  try {
    await node.start();
    const hash = await node.publishEvent(envelope);
    console.log(`[clawtoken] published wallet.escrow.refund ${hash}`);
  } finally {
    await node.stop();
  }
}

async function runEscrowExpire(
  rawArgs: string[],
  deps: { createNode?: NodeFactory } = {},
): Promise<void> {
  const parsed = parseEscrowExpireArgs(rawArgs);
  const keyId =
    parsed.keyId && parsed.keyId.length > 0
      ? parsed.keyId
      : keyIdFromPublicKey(publicKeyFromDid(parsed.did));
  const privateKey = await resolvePrivateKey(parsed.dataDir, keyId, parsed.passphrase);

  const paths = resolveStoragePaths(parsed.dataDir);
  const store = new LevelStore({ path: paths.eventsDb });
  const eventStore = new EventStore(store);
  let state: WalletState;
  try {
    state = await buildWalletState(eventStore);
  } finally {
    await store.close();
  }

  const escrow = state.escrows[parsed.escrowId];
  if (!escrow) {
    fail('escrow not found');
  }
  if (escrow.expiresAt === undefined) {
    fail('escrow has no expiry');
  }
  const ts = parsed.ts ?? Date.now();
  if (ts < escrow.expiresAt) {
    fail('escrow has not expired');
  }
  let remaining: bigint;
  try {
    remaining = BigInt(escrow.balance);
  } catch {
    fail('escrow balance invalid');
  }
  if (remaining <= 0n) {
    fail('escrow has no remaining balance');
  }

  const resourcePrev = findLatestEscrowHistoryHash(state, parsed.escrowId);
  if (!resourcePrev) {
    fail('escrow resource missing');
  }

  let envelope: EventEnvelope;
  if (parsed.action === 'release') {
    envelope = await createWalletEscrowReleaseEnvelope({
      issuer: parsed.did,
      privateKey,
      escrowId: parsed.escrowId,
      resourcePrev,
      amount: remaining.toString(),
      ruleId: parsed.ruleId ?? 'expired',
      ts,
      nonce: parsed.nonce,
      prev: parsed.prev,
    });
  } else {
    envelope = await createWalletEscrowRefundEnvelope({
      issuer: parsed.did,
      privateKey,
      escrowId: parsed.escrowId,
      resourcePrev,
      amount: remaining.toString(),
      reason: parsed.reason ?? 'expired',
      evidence: parsed.evidence,
      ts,
      nonce: parsed.nonce,
      prev: parsed.prev,
    });
  }

  const node = (deps.createNode ?? defaultNodeFactory)(parsed.nodeConfig);
  try {
    await node.start();
    const hash = await node.publishEvent(envelope);
    console.log(`[clawtoken] published wallet.escrow.${parsed.action ?? 'refund'} ${hash}`);
  } finally {
    await node.stop();
  }
}

function parseDaemonArgs(rawArgs: string[]): NodeRuntimeConfig {
  const config: {
    dataDir?: string;
    p2p?: { listen?: string[]; bootstrap?: string[] };
    sync?: {
      rangeIntervalMs?: number;
      snapshotIntervalMs?: number;
      requestRangeOnStart?: boolean;
      requestSnapshotOnStart?: boolean;
      sybilPolicy?: 'none' | 'allowlist' | 'pow' | 'stake';
      allowlist?: string[];
      powTicketTtlMs?: number;
      stakeProofTtlMs?: number;
      minPowDifficulty?: number;
      minSnapshotSignatures?: number;
    };
  } = {};

  const listen: string[] = [];
  const bootstrap: string[] = [];
  const allowlist: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === 'daemon') {
      continue;
    }
    switch (arg) {
      case '--data-dir': {
        config.dataDir = rawArgs[++i];
        break;
      }
      case '--listen': {
        const value = rawArgs[++i];
        if (value) {
          listen.push(value);
        }
        break;
      }
      case '--bootstrap': {
        const value = rawArgs[++i];
        if (value) {
          bootstrap.push(value);
        }
        break;
      }
      case '--range-interval-ms': {
        const value = parseNonNegativeInt(rawArgs[++i], '--range-interval-ms');
        config.sync = { ...config.sync, rangeIntervalMs: value };
        break;
      }
      case '--snapshot-interval-ms': {
        const value = parseNonNegativeInt(rawArgs[++i], '--snapshot-interval-ms');
        config.sync = { ...config.sync, snapshotIntervalMs: value };
        break;
      }
      case '--sybil-policy': {
        const value = rawArgs[++i];
        if (!value || !isSybilPolicy(value)) {
          fail(`invalid --sybil-policy: ${value ?? ''}`);
        }
        config.sync = { ...config.sync, sybilPolicy: value };
        break;
      }
      case '--allowlist': {
        const value = rawArgs[++i];
        if (value) {
          allowlist.push(
            ...value
              .split(',')
              .map((entry) => entry.trim())
              .filter(Boolean),
          );
        }
        break;
      }
      case '--pow-ttl-ms': {
        const value = parseNonNegativeInt(rawArgs[++i], '--pow-ttl-ms');
        config.sync = { ...config.sync, powTicketTtlMs: value };
        break;
      }
      case '--stake-ttl-ms': {
        const value = parseNonNegativeInt(rawArgs[++i], '--stake-ttl-ms');
        config.sync = { ...config.sync, stakeProofTtlMs: value };
        break;
      }
      case '--min-pow-difficulty': {
        const value = parseNonNegativeInt(rawArgs[++i], '--min-pow-difficulty');
        config.sync = { ...config.sync, minPowDifficulty: value };
        break;
      }
      case '--min-snapshot-signatures': {
        const value = parsePositiveInt(rawArgs[++i], '--min-snapshot-signatures');
        config.sync = { ...config.sync, minSnapshotSignatures: value };
        break;
      }
      case '--no-range-on-start': {
        config.sync = { ...config.sync, requestRangeOnStart: false };
        break;
      }
      case '--no-snapshot-on-start': {
        config.sync = { ...config.sync, requestSnapshotOnStart: false };
        break;
      }
      default: {
        console.warn(`[clawtoken] unknown argument: ${arg}`);
        break;
      }
    }
  }

  if (listen.length) {
    config.p2p = { ...config.p2p, listen };
  }
  if (bootstrap.length) {
    config.p2p = { ...config.p2p, bootstrap };
  }
  if (allowlist.length) {
    config.sync = { ...config.sync, allowlist };
  }

  return config;
}

function parseCapabilityRegisterArgs(rawArgs: string[]) {
  const listen: string[] = [];
  const bootstrap: string[] = [];
  let dataDir: string | undefined;
  let did: string | undefined;
  let keyId: string | undefined;
  let passphrase: string | undefined;
  let credentialPath: string | undefined;
  let nonce: number | undefined;
  let prev: string | undefined;
  let ts: number | undefined;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--data-dir': {
        dataDir = rawArgs[++i];
        break;
      }
      case '--listen': {
        const value = rawArgs[++i];
        if (value) {
          listen.push(value);
        }
        break;
      }
      case '--bootstrap': {
        const value = rawArgs[++i];
        if (value) {
          bootstrap.push(value);
        }
        break;
      }
      case '--did': {
        did = rawArgs[++i];
        break;
      }
      case '--key-id': {
        keyId = rawArgs[++i];
        break;
      }
      case '--passphrase': {
        passphrase = rawArgs[++i];
        break;
      }
      case '--credential': {
        credentialPath = rawArgs[++i];
        break;
      }
      case '--nonce': {
        nonce = parsePositiveInt(rawArgs[++i], '--nonce');
        break;
      }
      case '--prev': {
        prev = rawArgs[++i];
        break;
      }
      case '--ts': {
        ts = parseNonNegativeInt(rawArgs[++i], '--ts');
        break;
      }
      default: {
        console.warn(`[clawtoken] unknown argument: ${arg}`);
        break;
      }
    }
  }

  if (!did) {
    fail('missing --did');
  }
  if (!keyId) {
    fail('missing --key-id');
  }
  if (!passphrase) {
    fail('missing --passphrase');
  }
  if (!credentialPath) {
    fail('missing --credential');
  }
  if (nonce === undefined) {
    fail('missing --nonce');
  }

  const nodeConfig = parseDaemonArgs([
    ...(dataDir ? ['--data-dir', dataDir] : []),
    ...listen.flatMap((entry) => ['--listen', entry]),
    ...bootstrap.flatMap((entry) => ['--bootstrap', entry]),
  ]);

  return {
    did,
    keyId,
    passphrase,
    credentialPath,
    nonce,
    prev,
    ts,
    dataDir,
    nodeConfig,
  };
}

function parseBalanceArgs(rawArgs: string[]) {
  let did: string | undefined;
  let address: string | undefined;
  let dataDir: string | undefined;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--did': {
        did = rawArgs[++i];
        break;
      }
      case '--address': {
        address = rawArgs[++i];
        break;
      }
      case '--data-dir': {
        dataDir = rawArgs[++i];
        break;
      }
      default: {
        console.warn(`[clawtoken] unknown argument: ${arg}`);
        break;
      }
    }
  }

  if (!did && !address) {
    fail('missing --did or --address');
  }

  return { did: did ?? '', address, dataDir };
}

function parseTransferArgs(rawArgs: string[]) {
  let did: string | undefined;
  let passphrase: string | undefined;
  let keyId: string | undefined;
  let to: string | undefined;
  let amount: string | undefined;
  let fee: string | undefined;
  let memo: string | undefined;
  let nonce: number | undefined;
  let prev: string | undefined;
  let ts: number | undefined;
  let dataDir: string | undefined;
  const listen: string[] = [];
  const bootstrap: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--did': {
        did = rawArgs[++i];
        break;
      }
      case '--passphrase': {
        passphrase = rawArgs[++i];
        break;
      }
      case '--key-id': {
        keyId = rawArgs[++i];
        break;
      }
      case '--to': {
        to = rawArgs[++i];
        break;
      }
      case '--amount': {
        amount = rawArgs[++i];
        break;
      }
      case '--fee': {
        fee = rawArgs[++i];
        break;
      }
      case '--memo': {
        memo = rawArgs[++i];
        break;
      }
      case '--nonce': {
        nonce = parsePositiveInt(rawArgs[++i], '--nonce');
        break;
      }
      case '--prev': {
        prev = rawArgs[++i];
        break;
      }
      case '--ts': {
        ts = parseNonNegativeInt(rawArgs[++i], '--ts');
        break;
      }
      case '--data-dir': {
        dataDir = rawArgs[++i];
        break;
      }
      case '--listen': {
        const value = rawArgs[++i];
        if (value) {
          listen.push(value);
        }
        break;
      }
      case '--bootstrap': {
        const value = rawArgs[++i];
        if (value) {
          bootstrap.push(value);
        }
        break;
      }
      default: {
        console.warn(`[clawtoken] unknown argument: ${arg}`);
        break;
      }
    }
  }

  if (!did) {
    fail('missing --did');
  }
  if (!passphrase) {
    fail('missing --passphrase');
  }
  if (!to) {
    fail('missing --to');
  }
  if (!amount) {
    fail('missing --amount');
  }
  if (nonce === undefined) {
    fail('missing --nonce');
  }

  const nodeConfig = parseDaemonArgs([
    ...(dataDir ? ['--data-dir', dataDir] : []),
    ...listen.flatMap((entry) => ['--listen', entry]),
    ...bootstrap.flatMap((entry) => ['--bootstrap', entry]),
  ]);

  return {
    did,
    passphrase,
    keyId: keyId ?? '',
    to,
    amount,
    fee,
    memo,
    nonce,
    prev,
    ts,
    dataDir,
    nodeConfig,
  };
}

function parseReputationRecordArgs(rawArgs: string[]): ReputationRecordArgs {
  let did: string | undefined;
  let passphrase: string | undefined;
  let keyId: string | undefined;
  let target: string | undefined;
  let dimension: ReputationDimension | undefined;
  let score: number | undefined;
  let ref: string | undefined;
  let comment: string | undefined;
  let aspects: Record<ReputationAspectKey, number> | undefined;
  let nonce: number | undefined;
  let prev: string | undefined;
  let ts: number | undefined;
  let dataDir: string | undefined;
  const listen: string[] = [];
  const bootstrap: string[] = [];

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--did': {
        did = rawArgs[++i];
        break;
      }
      case '--passphrase': {
        passphrase = rawArgs[++i];
        break;
      }
      case '--key-id': {
        keyId = rawArgs[++i];
        break;
      }
      case '--target': {
        target = rawArgs[++i];
        break;
      }
      case '--dimension': {
        const value = rawArgs[++i];
        if (value && isReputationDimension(value)) {
          dimension = value;
        } else if (value) {
          fail(`invalid --dimension: ${value}`);
        }
        break;
      }
      case '--score': {
        score = parseScore(rawArgs[++i], '--score');
        break;
      }
      case '--ref': {
        ref = rawArgs[++i];
        break;
      }
      case '--comment': {
        comment = rawArgs[++i];
        break;
      }
      case '--aspects': {
        const raw = rawArgs[++i];
        aspects = parseAspects(raw, '--aspects');
        break;
      }
      case '--nonce': {
        nonce = parsePositiveInt(rawArgs[++i], '--nonce');
        break;
      }
      case '--prev': {
        prev = rawArgs[++i];
        break;
      }
      case '--ts': {
        ts = parseNonNegativeInt(rawArgs[++i], '--ts');
        break;
      }
      case '--data-dir': {
        dataDir = rawArgs[++i];
        break;
      }
      case '--listen': {
        const value = rawArgs[++i];
        if (value) {
          listen.push(value);
        }
        break;
      }
      case '--bootstrap': {
        const value = rawArgs[++i];
        if (value) {
          bootstrap.push(value);
        }
        break;
      }
      default: {
        console.warn(`[clawtoken] unknown argument: ${arg}`);
        break;
      }
    }
  }

  if (!did) {
    fail('missing --did');
  }
  if (!passphrase) {
    fail('missing --passphrase');
  }
  if (!target) {
    fail('missing --target');
  }
  if (!dimension) {
    fail('missing --dimension');
  }
  if (score === undefined) {
    fail('missing --score');
  }
  if (!ref) {
    fail('missing --ref');
  }
  if (nonce === undefined) {
    fail('missing --nonce');
  }

  const nodeConfig = parseDaemonArgs([
    ...(dataDir ? ['--data-dir', dataDir] : []),
    ...listen.flatMap((entry) => ['--listen', entry]),
    ...bootstrap.flatMap((entry) => ['--bootstrap', entry]),
  ]);

  return {
    did,
    passphrase,
    keyId: keyId ?? '',
    target,
    dimension,
    score,
    ref,
    comment,
    aspects,
    nonce,
    prev,
    ts,
    dataDir,
    nodeConfig,
  };
}

function parseEscrowCreateArgs(rawArgs: string[]) {
  let did: string | undefined;
  let passphrase: string | undefined;
  let keyId: string | undefined;
  let beneficiary: string | undefined;
  let amount: string | undefined;
  let releaseRulesRaw: string | undefined;
  let escrowId: string | undefined;
  let resourcePrev: string | null | undefined;
  let arbiter: string | undefined;
  let refundRulesRaw: string | undefined;
  let expiresAt: number | undefined;
  let nonce: number | undefined;
  let prev: string | undefined;
  let ts: number | undefined;
  let dataDir: string | undefined;
  let autoFund = true;
  const listen: string[] = [];
  const bootstrap: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--did': {
        did = rawArgs[++i];
        break;
      }
      case '--passphrase': {
        passphrase = rawArgs[++i];
        break;
      }
      case '--key-id': {
        keyId = rawArgs[++i];
        break;
      }
      case '--beneficiary': {
        beneficiary = rawArgs[++i];
        break;
      }
      case '--amount': {
        amount = rawArgs[++i];
        break;
      }
      case '--release-rules': {
        releaseRulesRaw = rawArgs[++i];
        break;
      }
      case '--escrow-id': {
        escrowId = rawArgs[++i];
        break;
      }
      case '--resource-prev': {
        const value = rawArgs[++i];
        resourcePrev = value === 'null' ? null : value;
        break;
      }
      case '--arbiter': {
        arbiter = rawArgs[++i];
        break;
      }
      case '--refund-rules': {
        refundRulesRaw = rawArgs[++i];
        break;
      }
      case '--expires-at': {
        expiresAt = parseNonNegativeInt(rawArgs[++i], '--expires-at');
        break;
      }
      case '--nonce': {
        nonce = parsePositiveInt(rawArgs[++i], '--nonce');
        break;
      }
      case '--prev': {
        prev = rawArgs[++i];
        break;
      }
      case '--ts': {
        ts = parseNonNegativeInt(rawArgs[++i], '--ts');
        break;
      }
      case '--data-dir': {
        dataDir = rawArgs[++i];
        break;
      }
      case '--listen': {
        const value = rawArgs[++i];
        if (value) {
          listen.push(value);
        }
        break;
      }
      case '--bootstrap': {
        const value = rawArgs[++i];
        if (value) {
          bootstrap.push(value);
        }
        break;
      }
      case '--no-auto-fund': {
        autoFund = false;
        break;
      }
      default: {
        console.warn(`[clawtoken] unknown argument: ${arg}`);
        break;
      }
    }
  }

  if (!did) {
    fail('missing --did');
  }
  if (!passphrase) {
    fail('missing --passphrase');
  }
  if (!beneficiary) {
    fail('missing --beneficiary');
  }
  if (!amount) {
    fail('missing --amount');
  }
  if (!releaseRulesRaw) {
    fail('missing --release-rules');
  }
  if (nonce === undefined) {
    fail('missing --nonce');
  }

  let releaseRules: Record<string, unknown>[];
  try {
    releaseRules = JSON.parse(releaseRulesRaw) as Record<string, unknown>[];
  } catch {
    fail('invalid --release-rules (must be JSON array)');
  }
  let refundRules: Record<string, unknown>[] | undefined;
  if (refundRulesRaw) {
    try {
      refundRules = JSON.parse(refundRulesRaw) as Record<string, unknown>[];
    } catch {
      fail('invalid --refund-rules (must be JSON array)');
    }
  }

  const nodeConfig = parseDaemonArgs([
    ...(dataDir ? ['--data-dir', dataDir] : []),
    ...listen.flatMap((entry) => ['--listen', entry]),
    ...bootstrap.flatMap((entry) => ['--bootstrap', entry]),
  ]);

  return {
    did,
    passphrase,
    keyId: keyId ?? '',
    beneficiary,
    amount,
    releaseRules,
    escrowId,
    resourcePrev,
    arbiter,
    refundRules,
    expiresAt,
    nonce,
    prev,
    ts,
    dataDir,
    autoFund,
    nodeConfig,
  };
}

function parseEscrowActionArgs(rawArgs: string[]) {
  let did: string | undefined;
  let passphrase: string | undefined;
  let keyId: string | undefined;
  let escrowId: string | undefined;
  let amount: string | undefined;
  let resourcePrev: string | undefined;
  let ruleId: string | undefined;
  let reason: string | undefined;
  let evidenceRaw: string | undefined;
  let nonce: number | undefined;
  let prev: string | undefined;
  let ts: number | undefined;
  let dataDir: string | undefined;
  const listen: string[] = [];
  const bootstrap: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--did': {
        did = rawArgs[++i];
        break;
      }
      case '--passphrase': {
        passphrase = rawArgs[++i];
        break;
      }
      case '--key-id': {
        keyId = rawArgs[++i];
        break;
      }
      case '--escrow-id': {
        escrowId = rawArgs[++i];
        break;
      }
      case '--amount': {
        amount = rawArgs[++i];
        break;
      }
      case '--resource-prev': {
        resourcePrev = rawArgs[++i];
        break;
      }
      case '--rule-id': {
        ruleId = rawArgs[++i];
        break;
      }
      case '--reason': {
        reason = rawArgs[++i];
        break;
      }
      case '--evidence': {
        evidenceRaw = rawArgs[++i];
        break;
      }
      case '--nonce': {
        nonce = parsePositiveInt(rawArgs[++i], '--nonce');
        break;
      }
      case '--prev': {
        prev = rawArgs[++i];
        break;
      }
      case '--ts': {
        ts = parseNonNegativeInt(rawArgs[++i], '--ts');
        break;
      }
      case '--data-dir': {
        dataDir = rawArgs[++i];
        break;
      }
      case '--listen': {
        const value = rawArgs[++i];
        if (value) {
          listen.push(value);
        }
        break;
      }
      case '--bootstrap': {
        const value = rawArgs[++i];
        if (value) {
          bootstrap.push(value);
        }
        break;
      }
      default: {
        console.warn(`[clawtoken] unknown argument: ${arg}`);
        break;
      }
    }
  }

  if (!did) {
    fail('missing --did');
  }
  if (!passphrase) {
    fail('missing --passphrase');
  }
  if (!escrowId) {
    fail('missing --escrow-id');
  }
  if (!amount) {
    fail('missing --amount');
  }
  if (!resourcePrev) {
    fail('missing --resource-prev');
  }
  if (nonce === undefined) {
    fail('missing --nonce');
  }

  let evidence: Record<string, unknown>[] | undefined;
  if (evidenceRaw) {
    try {
      evidence = JSON.parse(evidenceRaw) as Record<string, unknown>[];
    } catch {
      fail('invalid --evidence (must be JSON array)');
    }
  }

  const nodeConfig = parseDaemonArgs([
    ...(dataDir ? ['--data-dir', dataDir] : []),
    ...listen.flatMap((entry) => ['--listen', entry]),
    ...bootstrap.flatMap((entry) => ['--bootstrap', entry]),
  ]);

  return {
    did,
    passphrase,
    keyId: keyId ?? '',
    escrowId,
    amount,
    resourcePrev,
    ruleId,
    reason,
    evidence,
    nonce,
    prev,
    ts,
    dataDir,
    nodeConfig,
  };
}

function parseEscrowExpireArgs(rawArgs: string[]) {
  let did: string | undefined;
  let passphrase: string | undefined;
  let keyId: string | undefined;
  let escrowId: string | undefined;
  let action: 'refund' | 'release' | undefined;
  let ruleId: string | undefined;
  let reason: string | undefined;
  let evidenceRaw: string | undefined;
  let nonce: number | undefined;
  let prev: string | undefined;
  let ts: number | undefined;
  let dataDir: string | undefined;
  const listen: string[] = [];
  const bootstrap: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    switch (arg) {
      case '--did': {
        did = rawArgs[++i];
        break;
      }
      case '--passphrase': {
        passphrase = rawArgs[++i];
        break;
      }
      case '--key-id': {
        keyId = rawArgs[++i];
        break;
      }
      case '--escrow-id': {
        escrowId = rawArgs[++i];
        break;
      }
      case '--action': {
        const value = rawArgs[++i];
        if (value === 'refund' || value === 'release') {
          action = value;
        } else {
          fail('invalid --action (use refund or release)');
        }
        break;
      }
      case '--rule-id': {
        ruleId = rawArgs[++i];
        break;
      }
      case '--reason': {
        reason = rawArgs[++i];
        break;
      }
      case '--evidence': {
        evidenceRaw = rawArgs[++i];
        break;
      }
      case '--nonce': {
        nonce = parsePositiveInt(rawArgs[++i], '--nonce');
        break;
      }
      case '--prev': {
        prev = rawArgs[++i];
        break;
      }
      case '--ts': {
        ts = parseNonNegativeInt(rawArgs[++i], '--ts');
        break;
      }
      case '--data-dir': {
        dataDir = rawArgs[++i];
        break;
      }
      case '--listen': {
        const value = rawArgs[++i];
        if (value) {
          listen.push(value);
        }
        break;
      }
      case '--bootstrap': {
        const value = rawArgs[++i];
        if (value) {
          bootstrap.push(value);
        }
        break;
      }
      default: {
        console.warn(`[clawtoken] unknown argument: ${arg}`);
        break;
      }
    }
  }

  if (!did) {
    fail('missing --did');
  }
  if (!passphrase) {
    fail('missing --passphrase');
  }
  if (!escrowId) {
    fail('missing --escrow-id');
  }
  if (nonce === undefined) {
    fail('missing --nonce');
  }

  let evidence: Record<string, unknown>[] | undefined;
  if (evidenceRaw) {
    try {
      evidence = JSON.parse(evidenceRaw) as Record<string, unknown>[];
    } catch {
      fail('invalid --evidence (must be JSON array)');
    }
  }

  const nodeConfig = parseDaemonArgs([
    ...(dataDir ? ['--data-dir', dataDir] : []),
    ...listen.flatMap((entry) => ['--listen', entry]),
    ...bootstrap.flatMap((entry) => ['--bootstrap', entry]),
  ]);

  return {
    did,
    passphrase,
    keyId: keyId ?? '',
    escrowId,
    action,
    ruleId,
    reason,
    evidence,
    nonce,
    prev,
    ts,
    dataDir,
    nodeConfig,
  };
}

// ---------------------------------------------------------------------------
// DAO Governance CLI Commands
// ---------------------------------------------------------------------------

async function runDaoProposals(rawArgs: string[]): Promise<void> {
  const { apiArgs, rest } = splitApiArgs(rawArgs);
  const { apiUrl, token } = parseApiArgs(apiArgs);
  const status = rest.find((a) => !a.startsWith('-')) ?? undefined;
  const path = status
    ? `/api/dao/proposals?status=${encodeURIComponent(status)}`
    : '/api/dao/proposals';
  const result = await fetchApiJson(apiUrl, path, token);
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoProposal(rawArgs: string[]): Promise<void> {
  const { apiArgs, rest } = splitApiArgs(rawArgs);
  const { apiUrl, token } = parseApiArgs(apiArgs);
  const proposalId = rest[0];
  if (!proposalId) fail('missing proposal id');
  const result = await fetchApiJson(
    apiUrl,
    `/api/dao/proposals/${encodeURIComponent(proposalId)}`,
    token,
  );
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoCreateProposal(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data } = await parseApiArgsWithData(rawArgs);
  const result = await fetchApiJsonWithBody(apiUrl, '/api/dao/proposals', 'POST', data, token);
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoAdvanceProposal(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const proposalId = rest[0] ?? (data.proposalId as string);
  if (!proposalId) fail('missing proposal id');
  const result = await fetchApiJsonWithBody(
    apiUrl,
    `/api/dao/proposals/${encodeURIComponent(proposalId)}/advance`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoVote(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data } = await parseApiArgsWithData(rawArgs);
  const result = await fetchApiJsonWithBody(apiUrl, '/api/dao/vote', 'POST', data, token);
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoVotes(rawArgs: string[]): Promise<void> {
  const { apiArgs, rest } = splitApiArgs(rawArgs);
  const { apiUrl, token } = parseApiArgs(apiArgs);
  const proposalId = rest[0];
  if (!proposalId) fail('missing proposal id');
  const result = await fetchApiJson(
    apiUrl,
    `/api/dao/proposals/${encodeURIComponent(proposalId)}/votes`,
    token,
  );
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoDelegate(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data } = await parseApiArgsWithData(rawArgs);
  const result = await fetchApiJsonWithBody(apiUrl, '/api/dao/delegate', 'POST', data, token);
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoRevokeDelegation(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data } = await parseApiArgsWithData(rawArgs);
  const result = await fetchApiJsonWithBody(
    apiUrl,
    '/api/dao/delegate/revoke',
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoDelegations(rawArgs: string[]): Promise<void> {
  const { apiArgs, rest } = splitApiArgs(rawArgs);
  const { apiUrl, token } = parseApiArgs(apiArgs);
  const did = rest[0];
  if (!did) fail('missing DID');
  const result = await fetchApiJson(
    apiUrl,
    `/api/dao/delegations/${encodeURIComponent(did)}`,
    token,
  );
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoTreasury(rawArgs: string[]): Promise<void> {
  const { apiUrl, token } = parseApiArgs(rawArgs);
  const result = await fetchApiJson(apiUrl, '/api/dao/treasury', token);
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoDeposit(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data } = await parseApiArgsWithData(rawArgs);
  const result = await fetchApiJsonWithBody(
    apiUrl,
    '/api/dao/treasury/deposit',
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoTimelock(rawArgs: string[]): Promise<void> {
  const { apiUrl, token } = parseApiArgs(rawArgs);
  const result = await fetchApiJson(apiUrl, '/api/dao/timelock', token);
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoTimelockExecute(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const actionId = rest[0] ?? (data.actionId as string);
  if (!actionId) fail('missing action id');
  const result = await fetchApiJsonWithBody(
    apiUrl,
    `/api/dao/timelock/${encodeURIComponent(actionId)}/execute`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoTimelockCancel(rawArgs: string[]): Promise<void> {
  const { apiUrl, token, data, rest } = await parseApiArgsWithData(rawArgs);
  const actionId = rest[0] ?? (data.actionId as string);
  if (!actionId) fail('missing action id');
  const result = await fetchApiJsonWithBody(
    apiUrl,
    `/api/dao/timelock/${encodeURIComponent(actionId)}/cancel`,
    'POST',
    data,
    token,
  );
  console.log(JSON.stringify(result, null, 2));
}

async function runDaoParams(rawArgs: string[]): Promise<void> {
  const { apiUrl, token } = parseApiArgs(rawArgs);
  const result = await fetchApiJson(apiUrl, '/api/dao/params', token);
  console.log(JSON.stringify(result, null, 2));
}

function printHelp(): void {
  console.log(`
clawtoken daemon [options]
clawtoken init [options]
clawtoken status [options]
clawtoken peers [options]
clawtoken identity capability-register [options]
clawtoken balance [options]
clawtoken transfer [options]
clawtoken logs [options]
clawtoken reputation [options]
clawtoken reputation reviews [options]
clawtoken reputation record [options]
clawtoken escrow create|fund|release|refund|expire [options]
clawtoken market info list|get|publish|purchase|subscribe|unsubscribe|deliver|confirm|review|remove|content|delivery [options]
clawtoken market task list|get|publish|bids|bid|accept|reject|withdraw|deliver|confirm|review|remove [options]
clawtoken market capability list|get|publish|lease|lease-get|invoke|pause|resume|terminate|remove [options]
clawtoken market dispute open|respond|resolve [options]
clawtoken contract list|get|create|sign|fund|complete|milestone-complete|milestone-approve|milestone-reject|dispute|dispute-resolve|settlement [options]
clawtoken dao proposals|proposal|create-proposal|advance|vote|votes|delegate|revoke-delegation|delegations|treasury|deposit|timelock|execute|cancel|params [options]

Daemon options:
  --data-dir <path>              Override storage root
  --listen <multiaddr>           Add a libp2p listen multiaddr (repeatable)
  --bootstrap <multiaddr>        Add a bootstrap peer multiaddr (repeatable)
  --range-interval-ms <ms>       Range sync interval (default: ${DEFAULT_SYNC_RUNTIME_CONFIG.rangeIntervalMs})
  --snapshot-interval-ms <ms>    Snapshot sync interval (default: ${DEFAULT_SYNC_RUNTIME_CONFIG.snapshotIntervalMs})
  --no-range-on-start            Disable initial range sync request
  --no-snapshot-on-start         Disable initial snapshot sync request
  --sybil-policy <mode>          Sybil policy: none|allowlist|pow|stake (default: ${DEFAULT_P2P_SYNC_CONFIG.sybilPolicy})
  --allowlist <peerId,...>       Comma-separated peerIds (repeatable)
  --pow-ttl-ms <ms>              PoW ticket TTL (default: ${DEFAULT_P2P_SYNC_CONFIG.powTicketTtlMs})
  --stake-ttl-ms <ms>            Stake proof TTL (default: ${DEFAULT_P2P_SYNC_CONFIG.stakeProofTtlMs})
  --min-pow-difficulty <n>       Minimum PoW difficulty (default: ${DEFAULT_P2P_SYNC_CONFIG.minPowDifficulty})
  --min-snapshot-signatures <n>  Minimum eligible snapshot signatures (default: ${DEFAULT_P2P_SYNC_CONFIG.minSnapshotSignatures})

Init options:
  --passphrase <text>            Passphrase to encrypt the key (min 12 chars)
  --data-dir <path>              Override storage root
  --mnemonic <words>             Provide existing mnemonic (optional)
  --mnemonic-passphrase <text>   Mnemonic passphrase (optional)
  --strength <bits>              Mnemonic strength bits (default: 256)

Status/peers options:
  --api <url>                    Node API base URL (default: http://127.0.0.1:9528)
  --token <token>                API token (optional)

Capability register options:
  --did <did>                    Issuer DID for the capability
  --key-id <id>                  Key record id in keystore
  --passphrase <text>            Passphrase to decrypt key record
  --credential <path>            JSON credential file (CapabilityCredential)
  --nonce <n>                    Monotonic nonce for issuer
  --prev <hash>                  Optional previous event hash
  --ts <ms>                      Override timestamp (default: now)
  --data-dir <path>              Override storage root
  --listen <multiaddr>           Add a libp2p listen multiaddr (repeatable)
  --bootstrap <multiaddr>        Add a bootstrap peer multiaddr (repeatable)

Balance options:
  --did <did>                    DID to query balance for
  --address <addr>               Address to query balance for
  --data-dir <path>              Override storage root

Transfer options:
  --did <did>                    Issuer DID
  --passphrase <text>            Passphrase to decrypt key record
  --key-id <id>                  Key record id in keystore (optional)
  --to <did|addr>                Recipient DID or address
  --amount <n>                   Transfer amount (Token)
  --fee <n>                      Fee amount (Token, default 1)
  --memo <text>                  Optional memo
  --nonce <n>                    Monotonic nonce for issuer
  --prev <hash>                  Optional previous event hash
  --ts <ms>                      Override timestamp (default: now)
  --data-dir <path>              Override storage root
  --listen <multiaddr>           Add a libp2p listen multiaddr (repeatable)
  --bootstrap <multiaddr>        Add a bootstrap peer multiaddr (repeatable)

Logs options:
  --data-dir <path>              Override storage root
  --file <path>                  Override log file path
  --follow, -f                   Follow log output

Reputation options:
  --did <did>                    Target DID (or provide as positional)
  --data-dir <path>              Override storage root
  --source <log|store>           Data source (default: log)

Reputation reviews options:
  --did <did>                    Target DID (or provide as positional)
  --limit <n>                    Max reviews to return (default 20)
  --offset <n>                   Offset for pagination (default 0)
  --data-dir <path>              Override storage root
  --source <log|store>           Data source (default: log)

Reputation record options:
  --did <did>                    Issuer DID
  --passphrase <text>            Passphrase to decrypt key record
  --key-id <id>                  Key record id in keystore (optional)
  --target <did>                 Reviewee DID
  --dimension <value>            Dimension (transaction|fulfillment|quality|social|behavior)
  --score <n>                    Score (0-1000 integer)
  --ref <text>                   Reference id (contract/order/etc)
  --comment <text>               Optional review comment
  --aspects <json>               JSON object (communication|quality|timeliness|professionalism, 1-5)
  --nonce <n>                    Monotonic nonce for issuer
  --prev <hash>                  Optional previous event hash
  --ts <ms>                      Override timestamp (default: now)
  --data-dir <path>              Override storage root
  --listen <multiaddr>           Add a libp2p listen multiaddr (repeatable)
  --bootstrap <multiaddr>        Add a bootstrap peer multiaddr (repeatable)

Escrow create options:
  --did <did>                    Issuer DID (depositor)
  --passphrase <text>            Passphrase to decrypt key record
  --key-id <id>                  Key record id in keystore (optional)
  --beneficiary <did|addr>       Beneficiary DID or address
  --amount <n>                   Escrow amount (Token)
  --release-rules <json>         JSON array of release rules
  --escrow-id <id>               Optional escrow id
  --resource-prev <hash|null>    Optional resourcePrev (use "null" for null)
  --arbiter <addr>               Optional arbiter address
  --refund-rules <json>          JSON array of refund rules
  --expires-at <ms>              Optional expiry timestamp
  --nonce <n>                    Monotonic nonce for issuer
  --prev <hash>                  Optional previous event hash
  --ts <ms>                      Override timestamp (default: now)
  --no-auto-fund                 Skip auto escrow.fund
  --data-dir <path>              Override storage root
  --listen <multiaddr>           Add a libp2p listen multiaddr (repeatable)
  --bootstrap <multiaddr>        Add a bootstrap peer multiaddr (repeatable)

Escrow fund/release/refund options:
  --did <did>                    Issuer DID
  --passphrase <text>            Passphrase to decrypt key record
  --key-id <id>                  Key record id in keystore (optional)
  --escrow-id <id>               Escrow id
  --amount <n>                   Amount (Token)
  --resource-prev <hash>         Resource previous hash
  --rule-id <id>                 Release rule id (release only)
  --reason <text>                Refund reason (refund only)
  --evidence <json>              JSON array of evidence (refund only)
  --nonce <n>                    Monotonic nonce for issuer
  --prev <hash>                  Optional previous event hash
  --ts <ms>                      Override timestamp (default: now)
  --data-dir <path>              Override storage root
  --listen <multiaddr>           Add a libp2p listen multiaddr (repeatable)
  --bootstrap <multiaddr>        Add a bootstrap peer multiaddr (repeatable)

Escrow expire options:
  --did <did>                    Issuer DID
  --passphrase <text>            Passphrase to decrypt key record
  --key-id <id>                  Key record id in keystore (optional)
  --escrow-id <id>               Escrow id
  --action <refund|release>      Expiry action (default: refund)
  --rule-id <id>                 Release rule id (release only)
  --reason <text>                Refund reason (refund only)
  --evidence <json>              JSON array of evidence (refund only)
  --nonce <n>                    Monotonic nonce for issuer
  --prev <hash>                  Optional previous event hash
  --ts <ms>                      Override timestamp (default: now)
  --data-dir <path>              Override storage root
  --listen <multiaddr>           Add a libp2p listen multiaddr (repeatable)
  --bootstrap <multiaddr>        Add a bootstrap peer multiaddr (repeatable)

Market info options:
  --api <url>                    Node API base URL (default: http://127.0.0.1:9528)
  --token <token>                API token (optional)
  --query <qs>                   Query string for list (e.g. "keyword=ai&minPrice=10")
  --data <json>                  Inline JSON payload for publish/purchase/deliver/confirm/review
  --data-file <path>             JSON payload file for publish/purchase/deliver/confirm/review
  -h, --help                     Show help

DAO governance options:
  clawtoken dao proposals [status] -- List proposals (optional status filter)
  clawtoken dao proposal <id>      -- Get proposal details
  clawtoken dao create-proposal --data <json>  -- Create a new proposal
  clawtoken dao advance <id> --data <json>     -- Advance proposal status
  clawtoken dao vote --data <json>             -- Cast a vote
  clawtoken dao votes <proposalId>             -- Get votes for a proposal
  clawtoken dao delegate --data <json>         -- Set delegation
  clawtoken dao revoke-delegation --data <json> -- Revoke delegation
  clawtoken dao delegations <did>              -- List delegations for a DID
  clawtoken dao treasury                       -- View treasury status
  clawtoken dao deposit --data <json>          -- Deposit to treasury
  clawtoken dao timelock                       -- List timelock entries
  clawtoken dao execute <actionId> --data <json> -- Execute timelocked action
  clawtoken dao cancel <actionId> --data <json>  -- Cancel timelocked action
  clawtoken dao params                         -- View governance parameters
  --api <url>                    Node API base URL (default: http://127.0.0.1:9528)
  --token <token>                API token (optional)
`);
}

function resolveAddress(value: string): string | null {
  if (!value) {
    return null;
  }
  if (value.startsWith('did:claw:')) {
    try {
      return addressFromDid(value);
    } catch {
      return null;
    }
  }
  return value;
}

async function resolvePrivateKey(
  dataDir: string | undefined,
  keyId: string,
  passphrase: string,
): Promise<Uint8Array> {
  const paths = resolveStoragePaths(dataDir);
  const record = await loadKeyRecord(paths, keyId);
  return decryptKeyRecord(record, passphrase);
}

async function buildWalletState(eventStore: EventStore) {
  let state = createWalletState();
  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) {
        continue;
      }
      state = applyWalletEvent(state, envelope);
    }
    if (!next) {
      break;
    }
    cursor = next;
  }
  return state;
}

function findLatestEscrowHistoryHash(
  state: WalletState,
  escrowId: string,
): string | null {
  for (let i = state.history.length - 1; i >= 0; i -= 1) {
    const entry = state.history[i];
    if (!entry || !entry.payload) {
      continue;
    }
    if (!entry.type.startsWith('wallet.escrow.')) {
      continue;
    }
    if (entry.payload.escrowId !== escrowId) {
      continue;
    }
    return entry.hash;
  }
  return null;
}

async function buildReputationState(eventStore: EventStore) {
  let state = createReputationState();
  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) {
        continue;
      }
      try {
        state = applyReputationEvent(state, envelope);
      } catch {
        continue;
      }
    }
    if (!next) {
      break;
    }
    cursor = next;
  }
  return state;
}

async function buildReputationStore(eventStore: EventStore): Promise<MemoryReputationStore> {
  const store = new MemoryReputationStore();
  let cursor: string | null = null;
  while (true) {
    const { events, cursor: next } = await eventStore.getEventLogRange(cursor, 200);
    if (!events.length) {
      break;
    }
    for (const bytes of events) {
      const envelope = parseEvent(bytes);
      if (!envelope) {
        continue;
      }
      try {
        await store.applyEvent(envelope as EventEnvelope);
      } catch {
        continue;
      }
    }
    if (!next) {
      break;
    }
    cursor = next;
  }
  return store;
}

function parseEvent(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    return JSON.parse(bytesToUtf8(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapReputationLevel(level: ReputationLevel): { label: string; levelNumber: number } {
  switch (level) {
    case 'legend':
      return { label: 'Legend', levelNumber: 7 };
    case 'elite':
      return { label: 'Master', levelNumber: 6 };
    case 'expert':
      return { label: 'Expert', levelNumber: 5 };
    case 'trusted':
      return { label: 'Advanced', levelNumber: 4 };
    case 'newcomer':
      return { label: 'Intermediate', levelNumber: 3 };
    case 'observed':
      return { label: 'Beginner', levelNumber: 2 };
    case 'risky':
    default:
      return { label: 'Newcomer', levelNumber: 1 };
  }
}

function ratingFromScore(score: number): number {
  const rating = Math.round(score / 200);
  return Math.max(1, Math.min(5, rating));
}

function computeAverageRating(records: ReputationRecord[]): number {
  if (!records.length) {
    return 0;
  }
  const total = records.reduce((sum, record) => sum + ratingFromScore(record.score), 0);
  return Number((total / records.length).toFixed(2));
}

function isSybilPolicy(value: string): value is 'none' | 'allowlist' | 'pow' | 'stake' {
  return value === 'none' || value === 'allowlist' || value === 'pow' || value === 'stake';
}

function parseScore(value: string | undefined, flag: string): number {
  if (value === undefined) {
    fail(`missing value for ${flag}`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000) {
    fail(`invalid ${flag}: ${value}`);
  }
  return parsed;
}

function parseAspects(value: string | undefined, flag: string): Record<string, number> | undefined {
  if (value === undefined) {
    fail(`missing value for ${flag}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail(`invalid ${flag}: must be JSON object`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail(`invalid ${flag}: must be JSON object`);
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (!entries.length) {
    return undefined;
  }
  const aspects: Record<ReputationAspectKey, number> = {} as Record<ReputationAspectKey, number>;
  for (const [key, raw] of entries) {
    if (!isReputationAspectKey(key)) {
      fail(`invalid ${flag}: unsupported aspect ${key}`);
    }
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num) || !Number.isInteger(num)) {
      fail(`invalid ${flag}: ${key} must be an integer`);
    }
    if (num < 1 || num > 5) {
      fail(`invalid ${flag}: ${key} must be between 1 and 5`);
    }
    aspects[key] = num;
  }
  return aspects;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  if (value === undefined) {
    fail(`missing value for ${flag}`);
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    fail(`invalid ${flag}: ${value}`);
  }
  return parsed;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = parseNonNegativeInt(value, flag);
  if (parsed < 1) {
    fail(`invalid ${flag}: ${value}`);
  }
  return parsed;
}

function fail(message: string): never {
  console.error(`[clawtoken] ${message}`);
  process.exit(1);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entrypoint && import.meta.url === entrypoint) {
  void main().catch((error) => {
    console.error('[clawtoken] fatal error:', error);
    process.exit(1);
  });
}

export {
  main,
  runInit,
  runStatus,
  runPeers,
  runBalance,
  runTransfer,
  runLogs,
  runReputation,
  runReputationReviews,
  runReputationRecord,
  runEscrowCreate,
  runEscrowFund,
  runEscrowRelease,
  runEscrowRefund,
  runEscrowExpire,
};
