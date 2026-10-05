/**
 * Token creation and management utility
 * Generates a secure bearer token and writes it to a file with mode 0600
 * Refuses to write if the target file would be group/world-readable
 */

import { randomBytes } from "crypto";
import { readFileSync, writeFileSync, statSync, mkdirSync } from "fs";
import { chmod } from "fs/promises";
import { dirname } from "path";

/**
 * Generate a secure random token (32 bytes, hex-encoded)
 */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Check file permissions - return true if group/world-readable
 */
export function isFileWorldOrGroupReadable(path: string): boolean {
  try {
    const stats = statSync(path);
    const mode = stats.mode;
    // Check group-readable (0o040) or world-readable (0o004) bits
    return (mode & 0o044) !== 0;
  } catch {
    // File doesn't exist, no permissions issue
    return false;
  }
}

/**
 * Write token to file with mode 0600
 * Refuses if the file exists and is group/world-readable
 * @throws {Error} if file is group/world-readable or writing fails
 */
export async function writeTokenToFile(filePath: string, token: string): Promise<void> {
  // Check if file exists and has unsafe permissions
  if (isFileWorldOrGroupReadable(filePath)) {
    throw new Error(
      `Token file "${filePath}" exists with group or world-readable permissions (mode must be 0600)`
    );
  }

  // Create parent directories if they don't exist
  const parentDir = dirname(filePath);
  mkdirSync(parentDir, { recursive: true, mode: 0o700 });

  // Write the token file
  writeFileSync(filePath, token, { mode: 0o600 });

  // Verify that the file was created with correct permissions
  const stats = statSync(filePath);
  const mode = stats.mode & 0o777;
  if (mode !== 0o600) {
    throw new Error(
      `Failed to write token file with mode 0600; got mode ${(mode).toString(8)}`
    );
  }
}

/**
 * Create or verify a token file
 * Returns the token (either new or existing)
 */
export async function ensureTokenFile(filePath: string): Promise<string> {
  try {
    // Check if file exists and has unsafe permissions
    if (isFileWorldOrGroupReadable(filePath)) {
      throw new Error(
        `Token file "${filePath}" exists with group or world-readable permissions (mode must be 0600)`
      );
    }

    // Try to read existing token
    const existingToken = readFileSync(filePath, "utf-8").trim();
    if (existingToken) {
      return existingToken;
    }
  } catch (error) {
    // If it's a permissions error, re-throw it
    if (error instanceof Error && error.message.includes("group or world-readable")) {
      throw error;
    }
    // File doesn't exist, we'll create it
  }

  // Generate and write new token
  const token = generateToken();
  await writeTokenToFile(filePath, token);
  return token;
}

/**
 * Default copy function that pipes to pbcopy
 */
async function defaultCopyCommand(content: string): Promise<void> {
  const { spawn } = await import("child_process");
  return new Promise((resolve, reject) => {
    const proc = spawn("pbcopy");
    proc.stdin.write(content);
    proc.stdin.end();
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pbcopy exited with code ${code}`));
      }
    });
    proc.on("error", reject);
  });
}

/**
 * CLI entry point for token generation
 */
export async function main(args: string[], copy = defaultCopyCommand): Promise<void> {
  const filePath = args[0];
  const shouldCopy = args.includes("--copy");

  if (!filePath) {
    console.error("Usage: bun src/token.ts <token-file-path> [--copy]");
    process.exit(1);
  }

  try {
    const token = await ensureTokenFile(filePath);
    console.log(token);

    // If --copy flag is provided, copy token to clipboard
    if (shouldCopy) {
      await copy(token);
    }

    process.exit(0);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// Run main if this is the entry point
if (import.meta.main) {
  await main(process.argv.slice(2));
}
