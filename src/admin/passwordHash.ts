import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

const SCRYPT_PREFIX = "scrypt";
const DEFAULT_SCRYPT_COST = 16384;
const DEFAULT_SCRYPT_BLOCK_SIZE = 8;
const DEFAULT_SCRYPT_PARALLELIZATION = 1;
const DEFAULT_KEY_LENGTH = 64;

export type PasswordHashParts = {
  cost: number;
  blockSize: number;
  parallelization: number;
  keyLength: number;
  salt: Buffer;
  derivedKey: Buffer;
};

export function parsePasswordHash(passwordHash: string): PasswordHashParts {
  const parts = passwordHash.split("$");
  if (parts.length !== 7 || parts[0] !== SCRYPT_PREFIX) {
    throw new Error("Invalid scrypt password hash format.");
  }

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelization = Number(parts[3]);
  const keyLength = Number(parts[4]);
  const salt = Buffer.from(parts[5] || "", "base64url");
  const derivedKey = Buffer.from(parts[6] || "", "base64url");

  if (!Number.isInteger(cost) || cost <= 0 || !Number.isInteger(blockSize) || blockSize <= 0 ||
    !Number.isInteger(parallelization) || parallelization <= 0 || !Number.isInteger(keyLength) || keyLength <= 0 ||
    salt.length === 0 || derivedKey.length === 0) {
    throw new Error("Invalid scrypt password hash parameters.");
  }

  return { cost, blockSize, parallelization, keyLength, salt, derivedKey };
}

export function hashPassword(password: string, options: {
  salt?: Buffer;
  cost?: number;
  blockSize?: number;
  parallelization?: number;
  keyLength?: number;
} = {}): string {
  const salt = options.salt ?? randomBytes(16);
  const cost = options.cost ?? DEFAULT_SCRYPT_COST;
  const blockSize = options.blockSize ?? DEFAULT_SCRYPT_BLOCK_SIZE;
  const parallelization = options.parallelization ?? DEFAULT_SCRYPT_PARALLELIZATION;
  const keyLength = options.keyLength ?? DEFAULT_KEY_LENGTH;
  const derivedKey = scryptSync(password, salt, keyLength, {
    N: cost,
    r: blockSize,
    p: parallelization,
  });

  return [
    SCRYPT_PREFIX,
    String(cost),
    String(blockSize),
    String(parallelization),
    String(keyLength),
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export function verifyPasswordHash(password: string, passwordHash: string): boolean {
  const parsed = parsePasswordHash(passwordHash);
  const candidate = scryptSync(password, parsed.salt, parsed.keyLength, {
    N: parsed.cost,
    r: parsed.blockSize,
    p: parsed.parallelization,
  });

  if (candidate.length !== parsed.derivedKey.length) {
    return false;
  }

  return timingSafeEqual(candidate, parsed.derivedKey);
}

async function promptPassword(label: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(`${label}: `);
    return answer;
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const password = process.argv[2] ?? await promptPassword("Password");
  if (!password) {
    throw new Error("Password is required.");
  }

  process.stdout.write(`${hashPassword(password)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
