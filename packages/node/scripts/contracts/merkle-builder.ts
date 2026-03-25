#!/usr/bin/env ts-node
/**
 * merkle-builder.ts — Build Merkle trees from review lists, output root + proofs.
 *
 * Usage:
 *   npx ts-node scripts/merkle-builder.ts build   --input reviews.json [--output tree.json]
 *   npx ts-node scripts/merkle-builder.ts verify  --root 0x... --leaf 0x... --proof '["0x...","0x..."]'
 *
 * Input JSON format (reviews.json):
 *   [
 *     { "reviewHash": "0x...", "reviewerDID": "did:claw:...", "subjectDID": "did:claw:...", "txHash": "0x..." },
 *     ...
 *   ]
 *
 * Output JSON format (tree.json):
 *   {
 *     "root": "0x...",
 *     "leafCount": 4,
 *     "leaves": [ "0x...", ... ],
 *     "proofs": { "0x<leaf>": ["0x...", ...], ... }
 *   }
 */

import { keccak256, toUtf8Bytes, solidityPackedKeccak256, AbiCoder } from "ethers";
import { MerkleTree } from "merkletreejs";
import * as fs from "fs";
import * as path from "path";

// ── Types ─────────────────────────────────────────────────────────

interface ReviewInput {
  reviewHash: string;
  reviewerDID: string;
  subjectDID: string;
  txHash: string;
}

interface MerkleOutput {
  root: string;
  leafCount: number;
  leaves: string[];
  proofs: Record<string, string[]>;
}

// ── Leaf encoding ─────────────────────────────────────────────────

/**
 * Encode a review as a Merkle leaf: keccak256(abi.encodePacked(reviewHash, reviewerDIDHash, subjectDIDHash, txHash))
 */
function encodeLeaf(review: ReviewInput): string {
  const coder = AbiCoder.defaultAbiCoder();
  const encoded = coder.encode(
    ["bytes32", "bytes32", "bytes32", "bytes32"],
    [
      review.reviewHash,
      keccak256(toUtf8Bytes(review.reviewerDID)),
      keccak256(toUtf8Bytes(review.subjectDID)),
      review.txHash,
    ]
  );
  return keccak256(encoded);
}

// ── Build ─────────────────────────────────────────────────────────

function buildTree(reviews: ReviewInput[]): MerkleOutput {
  if (reviews.length === 0) {
    throw new Error("Cannot build Merkle tree from empty review list");
  }

  const leaves = reviews.map((r) => encodeLeaf(r));
  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = tree.getHexRoot();

  const proofs: Record<string, string[]> = {};
  for (const leaf of leaves) {
    proofs[leaf] = tree.getHexProof(leaf);
  }

  return {
    root,
    leafCount: leaves.length,
    leaves,
    proofs,
  };
}

// ── Verify ────────────────────────────────────────────────────────

function verifyProof(root: string, leaf: string, proof: string[]): boolean {
  return MerkleTree.verify(proof, leaf, root, keccak256, { sortPairs: true });
}

// ── CLI ───────────────────────────────────────────────────────────

function printUsage(): void {
  console.log(`
merkle-builder.ts — Build & verify Merkle trees for ClawReputation

Commands:
  build   --input <reviews.json> [--output <tree.json>]
  verify  --root <0x...> --leaf <0x...> --proof '["0x..."]'

Examples:
  npx ts-node scripts/merkle-builder.ts build --input reviews.json --output tree.json
  npx ts-node scripts/merkle-builder.ts verify --root 0xabc... --leaf 0xdef... --proof '["0x111...","0x222..."]'
  `);
}

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      result[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    process.exit(0);
  }

  if (command === "build") {
    const opts = parseArgs(args.slice(1));
    if (!opts.input) {
      console.error("Error: --input <file> is required");
      process.exit(1);
    }

    const inputPath = path.resolve(opts.input);
    if (!fs.existsSync(inputPath)) {
      console.error(`Error: file not found: ${inputPath}`);
      process.exit(1);
    }

    const reviews: ReviewInput[] = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
    console.log(`Building Merkle tree from ${reviews.length} reviews...`);

    const output = buildTree(reviews);
    console.log(`Root      : ${output.root}`);
    console.log(`Leaves    : ${output.leafCount}`);

    if (opts.output) {
      const outputPath = path.resolve(opts.output);
      fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
      console.log(`Output    : ${outputPath}`);
    } else {
      console.log(JSON.stringify(output, null, 2));
    }
  } else if (command === "verify") {
    const opts = parseArgs(args.slice(1));
    if (!opts.root || !opts.leaf || !opts.proof) {
      console.error("Error: --root, --leaf, --proof are all required");
      process.exit(1);
    }

    const proof: string[] = JSON.parse(opts.proof);
    const valid = verifyProof(opts.root, opts.leaf, proof);
    console.log(`Root  : ${opts.root}`);
    console.log(`Leaf  : ${opts.leaf}`);
    console.log(`Proof : [${proof.length} elements]`);
    console.log(`Valid : ${valid}`);
    process.exit(valid ? 0 : 1);
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
}

// ── Exports (for programmatic use) ───────────────────────────────

export { encodeLeaf, buildTree, verifyProof, ReviewInput, MerkleOutput };

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
