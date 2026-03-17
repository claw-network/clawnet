/**
 * Restore API Reference SDK examples that were incorrectly removed
 * by the strip-code-blocks script.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DOCS_DIR = join(import.meta.dirname, '..', 'packages', 'docs', 'content', 'docs');

// For each file, find the "API 参考" heading and replace everything from there to the 
// next major section with the correct API reference content from originals.

function readOriginal(name) {
  return readFileSync(join(import.meta.dirname, '..', 'docs', name), 'utf-8');
}

function extractSection(content, startPattern, endPatterns) {
  const lines = content.split('\n');
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(startPattern)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === -1) return null;
  
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    for (const pat of endPatterns) {
      if (lines[i].match(pat)) {
        endIdx = i;
        break;
      }
    }
    if (endIdx !== lines.length) break;
  }
  
  return lines.slice(startIdx, endIdx).join('\n');
}

function restoreFile(targetPath, originalName, sectionStart, sectionEnds) {
  const fullTarget = join(DOCS_DIR, targetPath);
  const target = readFileSync(fullTarget, 'utf-8');
  const original = readOriginal(originalName);
  
  // Extract the API section from original
  const apiSection = extractSection(original, sectionStart, sectionEnds);
  if (!apiSection) {
    console.log(`  WARNING: Could not find section in ${originalName}`);
    return;
  }
  
  // Find the same heading in the target
  const targetLines = target.split('\n');
  let insertIdx = -1;
  let removeEndIdx = -1;
  
  for (let i = 0; i < targetLines.length; i++) {
    if (targetLines[i].match(sectionStart)) {
      insertIdx = i;
      // Find where this section ends in target
      for (let j = i + 1; j < targetLines.length; j++) {
        for (const pat of sectionEnds) {
          if (targetLines[j].match(pat)) {
            removeEndIdx = j;
            break;
          }
        }
        if (removeEndIdx !== -1) break;
      }
      if (removeEndIdx === -1) removeEndIdx = targetLines.length;
      break;
    }
  }
  
  if (insertIdx === -1) {
    // Section doesn't exist in target, append before 相关文档 or end
    for (let i = targetLines.length - 1; i >= 0; i--) {
      if (targetLines[i].match(/^## 相关文档/) || targetLines[i].match(/^## 总结/)) {
        insertIdx = i;
        removeEndIdx = i;
        break;
      }
    }
    if (insertIdx === -1) {
      insertIdx = targetLines.length;
      removeEndIdx = targetLines.length;
    }
  }
  
  // Replace the section
  const before = targetLines.slice(0, insertIdx);
  const after = targetLines.slice(removeEndIdx);
  const result = [...before, apiSection, ...after].join('\n');
  
  writeFileSync(fullTarget, result, 'utf-8');
  console.log(`  ${targetPath}: restored API section (${apiSection.split('\n').length} lines)`);
}

console.log('Restoring API Reference sections...');

// Wallet
restoreFile(
  'core-modules/wallet.md',
  'WALLET.md',
  /^## API 参考/,
  [/^## 安全最佳实践/, /^## 相关文档/]
);

// Markets
restoreFile(
  'core-modules/markets.md',
  'MARKETS.md',
  /^## API 参考/,
  [/^## 相关文档/]
);

// Service Contracts
restoreFile(
  'core-modules/service-contracts.md',
  'SERVICE_CONTRACTS.md',
  /^## API 参考/,
  [/^## 合规与审计/, /^## 相关文档/]
);

// Reputation
restoreFile(
  'core-modules/reputation.md',
  'REPUTATION.md',
  /^## API 参考/,
  [/^## 权限与隐私/, /^## 相关文档/]
);

// DAO - governance examples
restoreFile(
  'core-modules/dao.md',
  'DAO.md',
  /^## 治理流程示例/,
  [/^## 治理仪表盘/, /^## 治理渐进计划/, /^## 相关文档/]
);

// Smart Contracts - usage example
restoreFile(
  'core-modules/smart-contracts.md',
  'SMART_CONTRACTS.md',
  /^## 使用示例/,
  [/^## 相关文档/]
);

console.log('Done!');
