/**
 * Script to replace code blocks in documentation with natural language.
 * 
 * Strategy:
 * - For files where ALL code blocks should be removed: strip all code blocks
 * - For files where SOME should be kept: strip only non-SDK code blocks
 * - TypeScript interfaces → markdown tables describing fields
 * - ASCII art → prose description
 * - Pseudo-code classes/functions → prose description
 * - Plain text in code fences → regular markdown
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DOCS_DIR = join(import.meta.dirname, '..', 'packages', 'docs', 'content', 'docs');

// Files where ALL code blocks should be removed
const ALL_REMOVE = [
  'core-modules/identity.md',
  'core-modules/markets-advanced.md',
  'business-economics/agent-business.md',
  'business-economics/decentralization.md',
  'implementation-specs/overview.md',
];

// Files where only API Reference / SDK example blocks should be kept
// Pattern: keep blocks that have `import` from `@claw-network` or are in "API" sections
const KEEP_SDK_ONLY = [
  'core-modules/wallet.md',
  'core-modules/markets.md',
  'core-modules/service-contracts.md',
  'core-modules/reputation.md',
  'core-modules/dao.md',
  'core-modules/smart-contracts.md',
  'getting-started/architecture.md',
  'developer-guide/agent-runtime.md',
  'developer-guide/openclaw-integration.md',
];

function parseCodeBlocks(content) {
  const blocks = [];
  const lines = content.split('\n');
  let inBlock = false;
  let blockStart = -1;
  let blockLang = '';
  let blockContent = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && line.trimStart().startsWith('```')) {
      inBlock = true;
      blockStart = i;
      blockLang = line.trimStart().slice(3).trim();
      blockContent = [];
    } else if (inBlock && line.trimStart() === '```') {
      blocks.push({
        start: blockStart,
        end: i,
        lang: blockLang,
        content: blockContent.join('\n'),
        raw: lines.slice(blockStart, i + 1).join('\n'),
      });
      inBlock = false;
    } else if (inBlock) {
      blockContent.push(line);
    }
  }
  return blocks;
}

function isSDKExample(block, lines, blockIndex) {
  const content = block.content;
  // Check if it contains SDK imports
  if (content.includes('@claw-network') || content.includes('from \'@claw')) return true;
  // Check if it's a CLI command (bash/shell)
  if (block.lang === 'bash' || block.lang === 'sh' || block.lang === 'shell') return true;
  // Check if it contains curl commands
  if (content.includes('curl ') || content.includes('curl\n')) return true;
  // Check if it's a config file (yaml, json, toml, nginx, dockerfile, ini)
  if (['yaml', 'yml', 'json', 'toml', 'nginx', 'dockerfile', 'ini', 'conf'].includes(block.lang)) return true;
  // Check if it's in an API Reference section
  const contextLines = lines.slice(Math.max(0, block.start - 30), block.start).join('\n');
  if (contextLines.includes('API 参考') || contextLines.includes('API Reference') || 
      contextLines.includes('使用示例') || contextLines.includes('Usage Example') ||
      contextLines.includes('快速示例') || contextLines.includes('Quick Example')) return true;
  // Check if it contains common SDK patterns
  if (content.includes('new Claw') || content.includes('ClawNet(') || 
      content.includes('createClient') || content.includes('clawnet ') ||
      content.includes('clawnetd ') || content.includes('pnpm ') ||
      content.includes('npm ') || content.includes('pip ') ||
      content.includes('docker ') || content.includes('git clone')) return true;
  // Python SDK examples
  if (content.includes('ClawNetClient') || content.includes('AsyncClawNet')) return true;
  return false;
}

function classifyBlock(block) {
  const content = block.content;
  const lang = block.lang;
  
  // ASCII art detection
  if (content.includes('┌') || content.includes('├') || content.includes('└') ||
      content.includes('│') || content.includes('─') || content.includes('╔') ||
      content.includes('║') || content.includes('╗') || content.includes('┐') ||
      content.includes('┤') || content.includes('▼') || content.includes('▲') ||
      content.includes('→') && content.includes('←')) {
    return 'ascii-art';
  }
  
  // TypeScript interface/type
  if ((lang === 'typescript' || lang === 'ts' || lang === '') &&
      (content.includes('interface ') || content.includes('type ') && content.includes('='))) {
    if (content.includes('class ') || content.includes('function ') || content.includes('async ')) {
      return 'pseudo-code';
    }
    return 'interface';
  }
  
  // Pseudo-code (classes, functions)
  if ((lang === 'typescript' || lang === 'ts' || lang === '') &&
      (content.includes('class ') || content.includes('function ') || 
       content.includes('async ') || content.includes('const ') || content.includes('export '))) {
    return 'pseudo-code';
  }
  
  // Plain text in code fences
  if (lang === '' || lang === 'text' || lang === 'plain') {
    return 'plain-text';
  }
  
  return 'other';
}

function extractInterfaceFields(content) {
  // Try to extract field definitions from TypeScript interfaces
  const fields = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^\s+(\w+)(\??)\s*:\s*(.+?)\s*;?\s*(\/\/\s*(.*))?$/);
    if (match) {
      fields.push({
        name: match[1],
        optional: match[2] === '?',
        type: match[3].replace(/;$/, '').trim(),
        description: match[5] || '',
      });
    }
  }
  return fields;
}

function extractInterfaceName(content) {
  const match = content.match(/(?:interface|type)\s+(\w+)/);
  return match ? match[1] : 'Unknown';
}

function extractClassName(content) {
  const match = content.match(/class\s+(\w+)/);
  return match ? match[1] : null;
}

function extractFunctionName(content) {
  const match = content.match(/(?:function|async function|const)\s+(\w+)/);
  return match ? match[1] : null;
}

function generateReplacement(block, type) {
  const content = block.content;
  
  switch (type) {
    case 'ascii-art':
      // Try to find the diagram purpose from surrounding context
      return ''; // Will be handled by removing the block entirely
      
    case 'interface': {
      const name = extractInterfaceName(content);
      const fields = extractInterfaceFields(content);
      
      // Check if there are multiple interfaces in one block
      const interfaceCount = (content.match(/interface\s+\w+/g) || []).length + 
                             (content.match(/type\s+\w+\s*=/g) || []).length;
      
      if (fields.length > 0 && interfaceCount <= 2) {
        let table = `**${name}** 的主要字段：\n\n`;
        table += '| 字段 | 类型 | 说明 |\n';
        table += '|------|------|------|\n';
        for (const f of fields.slice(0, 12)) { // Limit to 12 fields
          const desc = f.description || (f.optional ? '可选' : '');
          const typeStr = f.type.length > 40 ? f.type.slice(0, 37) + '...' : f.type;
          table += `| ${f.name} | ${typeStr} | ${desc} |\n`;
        }
        if (fields.length > 12) {
          table += `\n以及其他 ${fields.length - 12} 个字段。`;
        }
        return table;
      }
      
      // For complex multi-interface blocks, just describe
      const names = [...(content.matchAll(/(?:interface|type)\s+(\w+)/g))].map(m => m[1]);
      if (names.length > 1) {
        return `核心数据类型包括 ${names.map(n => '**' + n + '**').join('、')}，定义了该模块所需的关键数据结构。`;
      }
      return `**${name}** 定义了该功能所需的核心数据结构。`;
    }
    
    case 'pseudo-code': {
      const className = extractClassName(content);
      const funcName = extractFunctionName(content);
      
      if (className) {
        // Extract method names
        const methods = [...content.matchAll(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*\w+)?\s*\{/g)]
          .map(m => m[1])
          .filter(m => !['constructor', 'if', 'for', 'while', 'switch'].includes(m));
        
        if (methods.length > 0) {
          const uniqueMethods = [...new Set(methods)].slice(0, 8);
          return `**${className}** 负责处理该模块的核心逻辑，主要方法包括 ${uniqueMethods.map(m => '`' + m + '`').join('、')}。`;
        }
        return `**${className}** 封装了该模块的核心业务逻辑。`;
      }
      
      if (funcName) {
        return `\`${funcName}\` 函数处理该操作的核心流程。`;
      }
      
      return '该模块包含相应的业务处理逻辑。';
    }
    
    case 'plain-text':
      // Convert plain text to regular markdown
      // Remove leading/trailing whitespace, keep content
      return content.trim();
      
    default:
      return '';
  }
}

function processFile(relativePath, removeAll) {
  const fullPath = join(DOCS_DIR, relativePath);
  const content = readFileSync(fullPath, 'utf-8');
  const lines = content.split('\n');
  const blocks = parseCodeBlocks(content);
  
  if (blocks.length === 0) {
    console.log(`  ${relativePath}: no code blocks, skipping`);
    return;
  }
  
  let removedCount = 0;
  let keptCount = 0;
  
  // Process blocks in reverse order to maintain line numbers
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    const shouldKeep = !removeAll && isSDKExample(block, lines, i);
    
    if (shouldKeep) {
      keptCount++;
      continue;
    }
    
    const type = classifyBlock(block);
    const replacement = generateReplacement(block, type);
    
    // Remove the code block and replace with text
    const beforeBlock = lines.slice(0, block.start);
    const afterBlock = lines.slice(block.end + 1);
    
    // Check if there's a blank line before and we're adding text
    if (replacement) {
      lines.splice(block.start, block.end - block.start + 1, '', replacement, '');
    } else {
      // Just remove the block, keep one blank line
      lines.splice(block.start, block.end - block.start + 1, '');
    }
    
    removedCount++;
  }
  
  // Clean up excessive blank lines (more than 2 consecutive)
  const result = lines.join('\n').replace(/\n{4,}/g, '\n\n\n');
  
  writeFileSync(fullPath, result, 'utf-8');
  console.log(`  ${relativePath}: removed ${removedCount}, kept ${keptCount}`);
}

console.log('Processing ALL_REMOVE files...');
for (const file of ALL_REMOVE) {
  processFile(file, true);
}

console.log('\nProcessing KEEP_SDK_ONLY files...');
for (const file of KEEP_SDK_ONLY) {
  processFile(file, false);
}

console.log('\nDone!');
