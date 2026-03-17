import {
  entropyToMnemonic as entropyToMnemonicBase,
  generateMnemonic as generateMnemonicBase,
  mnemonicToEntropy as mnemonicToEntropyBase,
  mnemonicToSeed as mnemonicToSeedBase,
  mnemonicToSeedSync as mnemonicToSeedSyncBase,
  validateMnemonic as validateMnemonicBase,
} from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english';

export type Wordlist = string[];

export const DEFAULT_WORDLIST: Wordlist = english;

export function generateMnemonic(strength = 128, wordlist: Wordlist = DEFAULT_WORDLIST): string {
  return generateMnemonicBase(wordlist, strength);
}

export function validateMnemonic(mnemonic: string, wordlist: Wordlist = DEFAULT_WORDLIST): boolean {
  return validateMnemonicBase(mnemonic, wordlist);
}

export function mnemonicToEntropy(
  mnemonic: string,
  wordlist: Wordlist = DEFAULT_WORDLIST,
): Uint8Array {
  return mnemonicToEntropyBase(mnemonic, wordlist);
}

export function entropyToMnemonic(entropy: Uint8Array, wordlist: Wordlist = DEFAULT_WORDLIST): string {
  return entropyToMnemonicBase(entropy, wordlist);
}

export async function mnemonicToSeed(
  mnemonic: string,
  passphrase = '',
): Promise<Uint8Array> {
  return mnemonicToSeedBase(mnemonic, passphrase);
}

export function mnemonicToSeedSync(mnemonic: string, passphrase = ''): Uint8Array {
  return mnemonicToSeedSyncBase(mnemonic, passphrase);
}
