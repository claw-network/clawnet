#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  balanceOf,
  createRuntime,
  nowIso,
  parseArgs,
  printScriptHelp,
  toInt,
} from '../lib/bot-lib.mjs';

function parseBoolFlag(rawValue, fallback) {
  if (rawValue === undefined) return fallback;
  if (rawValue === true) return true;
  if (rawValue === false) return false;
  if (typeof rawValue !== 'string') {
    throw new Error(`Invalid boolean flag: ${rawValue}`);
  }
  const value = rawValue.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`Invalid boolean flag: ${rawValue}`);
}

function ensureString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required value: ${label}`);
  }
  return value.trim();
}

function parsePositiveInt(rawValue, label, rowRef = '') {
  if (typeof rawValue === 'number') {
    if (!Number.isInteger(rawValue) || rawValue <= 0) {
      throw new Error(`${label} must be a positive integer${rowRef}`);
    }
    return rawValue;
  }
  const value = ensureString(String(rawValue ?? ''), label);
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be a positive integer${rowRef}`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer${rowRef}`);
  }
  return parsed;
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (inQuotes) {
    throw new Error('Invalid CSV line (unclosed quote)');
  }
  values.push(current);
  return values;
}

function normalizeHeader(header) {
  return header.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeRecord(raw, rowNumber) {
  const to = ensureString(raw.to ?? raw.address ?? raw.did ?? '', `to (row ${rowNumber})`);
  const amount = parsePositiveInt(raw.amount, 'amount', ` (row ${rowNumber})`);
  const memo = typeof raw.memo === 'string' ? raw.memo.trim() : '';
  const incidentIdRaw = raw.incidentId ?? raw.incident_id ?? raw.caseId ?? raw.case_id;
  const incidentId =
    typeof incidentIdRaw === 'string' && incidentIdRaw.trim() ? incidentIdRaw.trim() : '';
  const requestIdRaw = raw.requestId ?? raw.request_id;
  const requestId = typeof requestIdRaw === 'string' && requestIdRaw.trim() ? requestIdRaw.trim() : '';
  return {
    index: rowNumber - 1,
    rowNumber,
    to,
    amount,
    memo,
    incidentId,
    requestId,
  };
}

function parseCsvRecords(content) {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith('#'));
  if (lines.length < 2) {
    throw new Error('CSV must include header and at least one data row');
  }
  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  if (!headers.includes('to') && !headers.includes('address') && !headers.includes('did')) {
    throw new Error('CSV must include `to` (or `address`/`did`) column');
  }
  if (!headers.includes('amount')) {
    throw new Error('CSV must include `amount` column');
  }

  const records = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j += 1) {
      row[headers[j]] = (values[j] ?? '').trim();
    }
    records.push(normalizeRecord(row, i + 1));
  }
  return records;
}

function parseJsonRecords(content) {
  let payload;
  try {
    payload = JSON.parse(content);
  } catch (error) {
    throw new Error(`Invalid JSON input: ${error.message}`);
  }
  if (!Array.isArray(payload)) {
    throw new Error('JSON input must be an array');
  }
  if (payload.length === 0) {
    throw new Error('JSON input is empty');
  }
  return payload.map((item, index) => normalizeRecord(item ?? {}, index + 2));
}

async function loadRecords(inputPath) {
  const absPath = path.resolve(process.cwd(), inputPath);
  const content = await fs.readFile(absPath, 'utf8');
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error(`Input file is empty: ${absPath}`);
  }

  if (absPath.endsWith('.json') || trimmed.startsWith('[')) {
    return { inputPath: absPath, records: parseJsonRecords(trimmed) };
  }
  return { inputPath: absPath, records: parseCsvRecords(trimmed) };
}

function resolveSenderAccount(config, args) {
  const fromArg = typeof args['from-account'] === 'string' ? args['from-account'].trim() : '';
  const configuredDefault =
    typeof config.reserve?.defaultSender === 'string' ? config.reserve.defaultSender.trim() : '';
  const fallback = config.accounts?.riskReserve ? 'riskReserve' : 'liquidityVault';
  const accountName = fromArg || configuredDefault || fallback;
  const account = config.accounts?.[accountName];
  if (
    !account ||
    typeof account !== 'object' ||
    typeof account.did !== 'string' ||
    !account.did.trim() ||
    typeof account.passphrase !== 'string' ||
    !account.passphrase.trim()
  ) {
    throw new Error(
      `Account not configured: accounts.${accountName}.did/passphrase (use --from-account or config.reserve.defaultSender)`,
    );
  }
  return {
    name: accountName,
    did: account.did.trim(),
    passphrase: account.passphrase,
  };
}

function composeMemo({
  memoPrefix,
  incidentIdFromArg,
  incidentIdFromRow,
  rowMemo,
  requestId,
}) {
  const parts = [];
  if (memoPrefix) parts.push(memoPrefix);
  if (incidentIdFromArg) parts.push(`incident:${incidentIdFromArg}`);
  if (incidentIdFromRow) parts.push(`case:${incidentIdFromRow}`);
  if (requestId) parts.push(`request:${requestId}`);
  if (rowMemo) parts.push(rowMemo);
  if (parts.length === 0) return undefined;
  return parts.join(' | ');
}

function guardLimits(records, maxPerTransfer, maxBatchTotal) {
  const total = records.reduce((sum, item) => sum + item.amount, 0);
  if (maxBatchTotal > 0 && total > maxBatchTotal) {
    throw new Error(
      `Batch total ${total} exceeds maxBatchTotal ${maxBatchTotal}. Use --max-batch-total to raise this limit.`,
    );
  }
  if (maxPerTransfer > 0) {
    const violator = records.find((item) => item.amount > maxPerTransfer);
    if (violator) {
      throw new Error(
        `Transfer amount ${violator.amount} exceeds maxPerTransfer ${maxPerTransfer} at row ${violator.rowNumber}`,
      );
    }
  }
  return total;
}

function buildOutputPaths(outputArg) {
  const stamp = nowIso().replace(/[:.]/g, '-');
  const defaultBase = path.resolve(
    process.cwd(),
    'scripts/liquidity-bot/logs',
    `reserve-compensation-${stamp}`,
  );
  if (!outputArg) {
    return {
      json: `${defaultBase}.json`,
      csv: `${defaultBase}.csv`,
    };
  }
  const absOutput = path.resolve(process.cwd(), outputArg);
  const ext = path.extname(absOutput).toLowerCase();
  if (ext === '.json') {
    return { json: absOutput, csv: `${absOutput.slice(0, -5)}.csv` };
  }
  if (ext === '.csv') {
    return { json: `${absOutput.slice(0, -4)}.json`, csv: absOutput };
  }
  return { json: `${absOutput}.json`, csv: `${absOutput}.csv` };
}

function toCsvCell(value) {
  const raw = value == null ? '' : String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function toCsv(rows) {
  const headers = [
    'index',
    'rowNumber',
    'to',
    'amount',
    'memo',
    'incidentId',
    'requestId',
    'status',
    'txHash',
    'error',
    'nonce',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((key) => toCsvCell(row[key])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function writeReport(report, outputPaths) {
  await fs.mkdir(path.dirname(outputPaths.json), { recursive: true });
  await fs.mkdir(path.dirname(outputPaths.csv), { recursive: true });
  await fs.writeFile(outputPaths.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(outputPaths.csv, toCsv(report.results), 'utf8');
}

function buildSummary({
  records,
  results,
  dryRun,
  inputPath,
  sender,
  senderBalance,
  maxPerTransfer,
  maxBatchTotal,
}) {
  const totalRequested = records.reduce((sum, item) => sum + item.amount, 0);
  const sent = results.filter((item) => item.status === 'sent').length;
  const failed = results.filter((item) => item.status === 'failed').length;
  const skipped = results.filter((item) => item.status === 'skipped').length;
  const dryRunRows = results.filter((item) => item.status === 'dry_run').length;
  const totalSentAmount = results
    .filter((item) => item.status === 'sent')
    .reduce((sum, item) => sum + item.amount, 0);
  return {
    at: nowIso(),
    mode: dryRun ? 'dry_run' : 'execute',
    inputPath,
    sender,
    senderBalance,
    maxPerTransfer,
    maxBatchTotal,
    totalRows: records.length,
    totalRequested,
    sent,
    failed,
    skipped,
    dryRunRows,
    totalSentAmount,
  };
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printScriptHelp(
      'cli/reserve-compensate.mjs',
      [
        'Required flags:',
        '  --input <path>                 CSV/JSON payout list. CSV columns: to,amount,memo,incidentId,requestId',
        '',
        'Execution flags:',
        '  --execute                      Actually send transfers. Default is dry-run.',
        '  --dry-run <bool>               Explicit dry-run on/off.',
        '  --continue-on-error <bool>     Continue remaining rows after one row fails. Default false.',
        '',
        'Optional guards:',
        '  --from-account <name>          Sender account key in config.accounts (default: riskReserve or liquidityVault).',
        '  --max-per-transfer <n>         Per-row hard limit (integer token amount).',
        '  --max-batch-total <n>          Batch total hard limit (integer token amount).',
        '  --skip-balance-check           Do not block when sender balance is lower than requested total.',
        '',
        'Optional metadata:',
        '  --memo-prefix <text>           Prefix added into every transfer memo.',
        '  --incident-id <id>             Batch-level incident identifier.',
        '  --output <path>                Output report base path or .json/.csv path.',
      ].join('\n'),
    );
    return;
  }

  if (!args.input || typeof args.input !== 'string') {
    throw new Error('Missing required --input <path>');
  }

  const executeFlag = parseBoolFlag(args.execute, false);
  const dryRunOverride = parseBoolFlag(args['dry-run'], !executeFlag);
  const dryRun = dryRunOverride;
  const continueOnError = parseBoolFlag(args['continue-on-error'], false);
  const skipBalanceCheck = parseBoolFlag(args['skip-balance-check'], false);
  const memoPrefix =
    typeof args['memo-prefix'] === 'string' && args['memo-prefix'].trim()
      ? args['memo-prefix'].trim()
      : '';
  const incidentIdFromArg =
    typeof args['incident-id'] === 'string' && args['incident-id'].trim()
      ? args['incident-id'].trim()
      : '';

  const rt = await createRuntime(args, { requiredAccounts: [] });
  const sender = resolveSenderAccount(rt.config, args);
  const { inputPath, records } = await loadRecords(args.input);
  const maxPerTransfer =
    args['max-per-transfer'] !== undefined
      ? parsePositiveInt(args['max-per-transfer'], '--max-per-transfer')
      : toInt(rt.config.reserve?.maxPerTransfer, 0);
  const maxBatchTotal =
    args['max-batch-total'] !== undefined
      ? parsePositiveInt(args['max-batch-total'], '--max-batch-total')
      : toInt(rt.config.reserve?.maxBatchTotal, 0);
  guardLimits(records, maxPerTransfer, maxBatchTotal);

  const senderWallet = await rt.api('GET', `/api/v1/wallets/${encodeURIComponent(sender.did)}`);
  const senderBalance = balanceOf(senderWallet);
  const totalRequested = records.reduce((sum, item) => sum + item.amount, 0);

  if (totalRequested > senderBalance && !skipBalanceCheck) {
    if (dryRun) {
      // eslint-disable-next-line no-console
      console.warn(
        `Warning: sender balance ${senderBalance} is lower than requested total ${totalRequested} (dry-run mode).`,
      );
    } else {
      throw new Error(
        `Sender balance ${senderBalance} is lower than requested total ${totalRequested}. Use --skip-balance-check only if you know a top-up will arrive before execution.`,
      );
    }
  }

  const outputPaths = buildOutputPaths(typeof args.output === 'string' ? args.output : '');
  const results = [];
  let aborted = false;

  for (let i = 0; i < records.length; i += 1) {
    const row = records[i];
    const memo = composeMemo({
      memoPrefix,
      incidentIdFromArg,
      incidentIdFromRow: row.incidentId,
      rowMemo: row.memo,
      requestId: row.requestId,
    });
    const nonce = rt.nextNonceFor(sender.did);
    if (dryRun) {
      results.push({
        index: row.index,
        rowNumber: row.rowNumber,
        to: row.to,
        amount: row.amount,
        memo: memo ?? '',
        incidentId: row.incidentId,
        requestId: row.requestId,
        status: 'dry_run',
        txHash: '',
        error: '',
        nonce,
      });
      continue;
    }

    try {
      const response = await rt.api('POST', '/api/v1/transfers', {
        did: sender.did,
        passphrase: sender.passphrase,
        nonce,
        to: row.to,
        amount: row.amount,
        memo,
      });
      results.push({
        index: row.index,
        rowNumber: row.rowNumber,
        to: row.to,
        amount: row.amount,
        memo: memo ?? '',
        incidentId: row.incidentId,
        requestId: row.requestId,
        status: 'sent',
        txHash: response?.txHash ?? '',
        error: '',
        nonce,
      });
    } catch (error) {
      results.push({
        index: row.index,
        rowNumber: row.rowNumber,
        to: row.to,
        amount: row.amount,
        memo: memo ?? '',
        incidentId: row.incidentId,
        requestId: row.requestId,
        status: 'failed',
        txHash: '',
        error: error instanceof Error ? error.message : String(error),
        nonce,
      });
      if (!continueOnError) {
        aborted = true;
        for (let j = i + 1; j < records.length; j += 1) {
          const skipped = records[j];
          results.push({
            index: skipped.index,
            rowNumber: skipped.rowNumber,
            to: skipped.to,
            amount: skipped.amount,
            memo: skipped.memo,
            incidentId: skipped.incidentId,
            requestId: skipped.requestId,
            status: 'skipped',
            txHash: '',
            error: 'skipped_due_to_previous_error',
            nonce: '',
          });
        }
        break;
      }
    }
  }

  const summary = buildSummary({
    records,
    results,
    dryRun,
    inputPath,
    sender: sender.name,
    senderBalance,
    maxPerTransfer,
    maxBatchTotal,
  });

  const report = {
    summary,
    sender: {
      account: sender.name,
      did: sender.did,
    },
    controls: {
      continueOnError,
      skipBalanceCheck,
      aborted,
    },
    output: outputPaths,
    results,
  };
  await writeReport(report, outputPaths);

  rt.state.runs.push({
    type: 'reserve_compensation',
    at: nowIso(),
    summary,
    output: outputPaths,
  });
  await rt.save();

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
  // eslint-disable-next-line no-console
  console.log(`Report JSON: ${outputPaths.json}`);
  // eslint-disable-next-line no-console
  console.log(`Report CSV : ${outputPaths.csv}`);

  if (!dryRun && summary.failed > 0) {
    throw new Error(`Batch finished with ${summary.failed} failed transfer(s).`);
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error.message);
  process.exit(1);
});
