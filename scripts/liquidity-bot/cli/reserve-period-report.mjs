#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { nowIso, parseArgs, toInt } from '../lib/bot-lib.mjs';

function printHelp() {
  const lines = [
    'Usage: node scripts/liquidity-bot/cli/reserve-period-report.mjs [options]',
    'Optional flags:',
    '  --period <week|month>          Aggregation period. Default: week',
    '  --anchor-date <YYYY-MM-DD>     Anchor date in UTC. Default: today (UTC).',
    '  --week-start <monday|sunday>   Week start for period=week. Default: monday.',
    '  --log-dir <path>               Source report dir. Default: scripts/liquidity-bot/logs',
    '  --pattern <text>               Filename contains text filter. Default: reserve-compensation',
    '  --include-dry-run <bool>       Include dry-run rows/files. Default false.',
    '  --output <path>                Output base path or .json/.csv path.',
    '  --help                         Show this help.',
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

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

function utcDateFrom(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function parseDateArg(rawValue, flagName = '--anchor-date') {
  if (rawValue === undefined || rawValue === null || rawValue === '') return '';
  if (typeof rawValue !== 'string') {
    throw new Error(`Invalid ${flagName} value: ${rawValue}`);
  }
  const value = rawValue.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid ${flagName} format: ${value} (expected YYYY-MM-DD)`);
  }
  const normalized = utcDateFrom(`${value}T00:00:00.000Z`);
  if (normalized !== value) {
    throw new Error(`Invalid ${flagName} value: ${value}`);
  }
  return value;
}

function parsePeriod(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return 'week';
  if (typeof rawValue !== 'string') {
    throw new Error(`Invalid --period value: ${rawValue}`);
  }
  const value = rawValue.trim().toLowerCase();
  if (!['week', 'month'].includes(value)) {
    throw new Error(`Invalid --period value: ${value} (expected week|month)`);
  }
  return value;
}

function parseWeekStart(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return 'monday';
  if (typeof rawValue !== 'string') {
    throw new Error(`Invalid --week-start value: ${rawValue}`);
  }
  const value = rawValue.trim().toLowerCase();
  if (!['monday', 'sunday'].includes(value)) {
    throw new Error(`Invalid --week-start value: ${value} (expected monday|sunday)`);
  }
  return value;
}

function parseUtcDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

function addUtcDays(date, deltaDays) {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + deltaDays);
  return copy;
}

function computeDateRange({ period, anchorDate, weekStart }) {
  const anchor = parseUtcDate(anchorDate);
  if (period === 'month') {
    const y = anchor.getUTCFullYear();
    const m = anchor.getUTCMonth();
    const from = new Date(Date.UTC(y, m, 1));
    const to = new Date(Date.UTC(y, m + 1, 0));
    return {
      fromDate: from.toISOString().slice(0, 10),
      toDate: to.toISOString().slice(0, 10),
      periodLabel: `${from.toISOString().slice(0, 7)}`,
    };
  }

  const day = anchor.getUTCDay();
  const offset = weekStart === 'monday' ? (day === 0 ? 6 : day - 1) : day;
  const from = addUtcDays(anchor, -offset);
  const to = addUtcDays(from, 6);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
    periodLabel: `${from.toISOString().slice(0, 10)}_to_${to.toISOString().slice(0, 10)}`,
  };
}

function normalizeIncidentId(rawValue) {
  if (typeof rawValue === 'string' && rawValue.trim()) return rawValue.trim();
  return '__NO_INCIDENT__';
}

function normalizeStatus(rawValue) {
  if (typeof rawValue !== 'string' || !rawValue.trim()) return 'unknown';
  return rawValue.trim().toLowerCase();
}

function toCsvCell(value) {
  const raw = value == null ? '' : String(value);
  if (/[",\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function toCsv(incidents) {
  const headers = [
    'incidentId',
    'rowCount',
    'requestedTotal',
    'sentCount',
    'sentAmount',
    'failedCount',
    'failedAmount',
    'dryRunCount',
    'dryRunAmount',
    'skippedCount',
    'skippedAmount',
    'unknownCount',
    'unknownAmount',
    'uniqueRecipients',
    'requestIdCount',
    'txHashCount',
    'reportCount',
    'firstSeen',
    'lastSeen',
    'failureExamples',
    'sourceReports',
  ];
  const lines = [headers.join(',')];
  for (const row of incidents) {
    lines.push(
      headers
        .map((key) => {
          if (key === 'failureExamples') {
            return toCsvCell((row.failureExamples ?? []).join(' | '));
          }
          if (key === 'sourceReports') {
            return toCsvCell((row.sourceReports ?? []).join(' | '));
          }
          return toCsvCell(row[key]);
        })
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

function buildOutputPaths({ logDir, period, periodLabel, outputArg }) {
  const stamp = nowIso().replace(/[:.]/g, '-');
  const defaultBase = path.resolve(logDir, `reserve-${period}-${periodLabel}-${stamp}`);
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

async function collectReportFiles(logDir, pattern) {
  let entries;
  try {
    entries = await fs.readdir(logDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Could not read log dir ${logDir}: ${error.message}`);
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .filter((entry) => !pattern || entry.name.includes(pattern))
    .map((entry) => path.join(logDir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function loadSingleReport(filePath) {
  const fileName = path.basename(filePath);
  let text;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    return { ok: false, filePath, fileName, error: `read_failed: ${error.message}` };
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    return { ok: false, filePath, fileName, error: `json_parse_failed: ${error.message}` };
  }

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.results)) {
    return {
      ok: false,
      filePath,
      fileName,
      error: 'invalid_report_shape: missing results[]',
    };
  }

  const summary = payload.summary && typeof payload.summary === 'object' ? payload.summary : {};
  let at = typeof summary.at === 'string' && summary.at.trim() ? summary.at.trim() : '';
  if (!at) {
    try {
      const stat = await fs.stat(filePath);
      at = stat.mtime.toISOString();
    } catch {
      at = '';
    }
  }
  const dateKey = utcDateFrom(at);
  const mode = typeof summary.mode === 'string' && summary.mode.trim() ? summary.mode.trim() : 'unknown';
  return {
    ok: true,
    filePath,
    fileName,
    at,
    dateKey,
    mode,
    sender: payload.sender?.account ?? summary.sender ?? '',
    inputPath: summary.inputPath ?? '',
    results: payload.results,
  };
}

function getOrCreateIncident(map, incidentId) {
  if (!map.has(incidentId)) {
    map.set(incidentId, {
      incidentId,
      rowCount: 0,
      requestedTotal: 0,
      sentCount: 0,
      sentAmount: 0,
      failedCount: 0,
      failedAmount: 0,
      dryRunCount: 0,
      dryRunAmount: 0,
      skippedCount: 0,
      skippedAmount: 0,
      unknownCount: 0,
      unknownAmount: 0,
      uniqueRecipients: 0,
      requestIdCount: 0,
      txHashCount: 0,
      reportCount: 0,
      firstSeen: '',
      lastSeen: '',
      failureExamples: [],
      sourceReports: [],
      _recipients: new Set(),
      _requestIds: new Set(),
      _txHashes: new Set(),
      _sources: new Set(),
      _failureExamples: new Set(),
    });
  }
  return map.get(incidentId);
}

function bumpStatus(entry, status, amount) {
  switch (status) {
    case 'sent':
      entry.sentCount += 1;
      entry.sentAmount += amount;
      break;
    case 'failed':
      entry.failedCount += 1;
      entry.failedAmount += amount;
      break;
    case 'dry_run':
      entry.dryRunCount += 1;
      entry.dryRunAmount += amount;
      break;
    case 'skipped':
      entry.skippedCount += 1;
      entry.skippedAmount += amount;
      break;
    default:
      entry.unknownCount += 1;
      entry.unknownAmount += amount;
      break;
  }
}

function trackTimeRange(entry, at) {
  if (!at) return;
  if (!entry.firstSeen || at < entry.firstSeen) {
    entry.firstSeen = at;
  }
  if (!entry.lastSeen || at > entry.lastSeen) {
    entry.lastSeen = at;
  }
}

function finalizeIncident(entry) {
  entry.uniqueRecipients = entry._recipients.size;
  entry.requestIdCount = entry._requestIds.size;
  entry.txHashCount = entry._txHashes.size;
  entry.reportCount = entry._sources.size;
  entry.sourceReports = Array.from(entry._sources).sort();
  entry.failureExamples = Array.from(entry._failureExamples).slice(0, 5);
  delete entry._recipients;
  delete entry._requestIds;
  delete entry._txHashes;
  delete entry._sources;
  delete entry._failureExamples;
}

function buildPeriodSummary({
  period,
  periodLabel,
  anchorDate,
  weekStart,
  fromDate,
  toDate,
  includeDryRun,
  logDir,
  pattern,
  rows,
  incidents,
  stats,
}) {
  return {
    generatedAt: nowIso(),
    timezone: 'UTC',
    period,
    periodLabel,
    anchorDate,
    weekStart: period === 'week' ? weekStart : null,
    fromDate,
    toDate,
    includeDryRun,
    logDir,
    filePattern: pattern,
    filesScanned: stats.filesScanned,
    filesLoaded: stats.filesLoaded,
    filesIncluded: stats.filesIncluded,
    filesSkippedNoDate: stats.filesSkippedNoDate,
    filesSkippedOutOfRange: stats.filesSkippedOutOfRange,
    filesSkippedByMode: stats.filesSkippedByMode,
    parseErrorCount: stats.parseErrors.length,
    incidentCount: incidents.length,
    rowCount: rows.length,
    requestedTotal: rows.reduce((sum, item) => sum + item.amount, 0),
    sentCount: rows.filter((item) => item.status === 'sent').length,
    sentAmount: rows.filter((item) => item.status === 'sent').reduce((sum, item) => sum + item.amount, 0),
    failedCount: rows.filter((item) => item.status === 'failed').length,
    failedAmount: rows
      .filter((item) => item.status === 'failed')
      .reduce((sum, item) => sum + item.amount, 0),
    dryRunCount: rows.filter((item) => item.status === 'dry_run').length,
    dryRunAmount: rows
      .filter((item) => item.status === 'dry_run')
      .reduce((sum, item) => sum + item.amount, 0),
    skippedCount: rows.filter((item) => item.status === 'skipped').length,
    skippedAmount: rows
      .filter((item) => item.status === 'skipped')
      .reduce((sum, item) => sum + item.amount, 0),
    unknownCount: rows.filter((item) => item.status === 'unknown').length,
    unknownAmount: rows
      .filter((item) => item.status === 'unknown')
      .reduce((sum, item) => sum + item.amount, 0),
  };
}

async function writeOutput(report, outputPaths) {
  await fs.mkdir(path.dirname(outputPaths.json), { recursive: true });
  await fs.mkdir(path.dirname(outputPaths.csv), { recursive: true });
  await fs.writeFile(outputPaths.json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.writeFile(outputPaths.csv, toCsv(report.incidents), 'utf8');
}

function dateInRange(dateKey, fromDate, toDate) {
  return dateKey >= fromDate && dateKey <= toDate;
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const includeDryRun = parseBoolFlag(args['include-dry-run'], false);
  const period = parsePeriod(args.period);
  const anchorDate = parseDateArg(args['anchor-date']) || nowIso().slice(0, 10);
  const weekStart = parseWeekStart(args['week-start']);
  const { fromDate, toDate, periodLabel } = computeDateRange({ period, anchorDate, weekStart });
  const logDir = path.resolve(
    process.cwd(),
    typeof args['log-dir'] === 'string' && args['log-dir'].trim()
      ? args['log-dir'].trim()
      : 'scripts/liquidity-bot/logs',
  );
  const pattern =
    typeof args.pattern === 'string' && args.pattern.trim() ? args.pattern.trim() : 'reserve-compensation';
  const outputPaths = buildOutputPaths({
    logDir,
    period,
    periodLabel,
    outputArg: typeof args.output === 'string' ? args.output : '',
  });

  const files = await collectReportFiles(logDir, pattern);
  const stats = {
    filesScanned: files.length,
    filesLoaded: 0,
    filesIncluded: 0,
    filesSkippedNoDate: 0,
    filesSkippedOutOfRange: 0,
    filesSkippedByMode: 0,
    parseErrors: [],
  };
  const sources = [];
  const rows = [];
  const incidentMap = new Map();

  for (const filePath of files) {
    const loaded = await loadSingleReport(filePath);
    if (!loaded.ok) {
      stats.parseErrors.push({ file: loaded.filePath, error: loaded.error });
      continue;
    }
    stats.filesLoaded += 1;

    if (!loaded.dateKey) {
      stats.filesSkippedNoDate += 1;
      continue;
    }
    if (!dateInRange(loaded.dateKey, fromDate, toDate)) {
      stats.filesSkippedOutOfRange += 1;
      continue;
    }
    if (!includeDryRun && loaded.mode === 'dry_run') {
      stats.filesSkippedByMode += 1;
      continue;
    }

    let processedRows = 0;
    for (const rawRow of loaded.results) {
      const amount = toInt(rawRow?.amount, 0);
      if (amount <= 0) continue;
      const status = normalizeStatus(rawRow?.status);
      if (!includeDryRun && status === 'dry_run') {
        continue;
      }
      const incidentId = normalizeIncidentId(rawRow?.incidentId);
      const requestId = typeof rawRow?.requestId === 'string' ? rawRow.requestId.trim() : '';
      const recipient = typeof rawRow?.to === 'string' ? rawRow.to.trim() : '';
      const txHash = typeof rawRow?.txHash === 'string' ? rawRow.txHash.trim() : '';
      const errorMessage = typeof rawRow?.error === 'string' ? rawRow.error.trim() : '';

      rows.push({
        incidentId,
        amount,
        status,
      });

      const entry = getOrCreateIncident(incidentMap, incidentId);
      entry.rowCount += 1;
      entry.requestedTotal += amount;
      bumpStatus(entry, status, amount);
      if (recipient) entry._recipients.add(recipient);
      if (requestId) entry._requestIds.add(requestId);
      if (txHash) entry._txHashes.add(txHash);
      if (loaded.fileName) entry._sources.add(loaded.fileName);
      if (status === 'failed' && errorMessage) {
        entry._failureExamples.add(errorMessage);
      }
      trackTimeRange(entry, loaded.at);
      processedRows += 1;
    }

    if (processedRows > 0) {
      stats.filesIncluded += 1;
      sources.push({
        file: loaded.filePath,
        at: loaded.at,
        date: loaded.dateKey,
        mode: loaded.mode,
        sender: loaded.sender,
        inputPath: loaded.inputPath,
        processedRows,
      });
    }
  }

  const incidents = Array.from(incidentMap.values());
  for (const incident of incidents) {
    finalizeIncident(incident);
  }
  incidents.sort((a, b) => {
    if (b.requestedTotal !== a.requestedTotal) return b.requestedTotal - a.requestedTotal;
    return a.incidentId.localeCompare(b.incidentId);
  });

  const report = {
    summary: buildPeriodSummary({
      period,
      periodLabel,
      anchorDate,
      weekStart,
      fromDate,
      toDate,
      includeDryRun,
      logDir,
      pattern,
      rows,
      incidents,
      stats,
    }),
    incidents,
    sources,
    parseErrors: stats.parseErrors,
    output: outputPaths,
  };

  await writeOutput(report, outputPaths);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        summary: report.summary,
        topIncidents: report.incidents.slice(0, 10),
      },
      null,
      2,
    ),
  );
  // eslint-disable-next-line no-console
  console.log(`Period report JSON: ${outputPaths.json}`);
  // eslint-disable-next-line no-console
  console.log(`Period report CSV : ${outputPaths.csv}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error.message);
  process.exit(1);
});
