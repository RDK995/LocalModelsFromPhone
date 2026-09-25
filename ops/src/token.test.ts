/**
 * Tests for token creation command
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, statSync, rmSync } from "fs";
import { writeFile, chmod } from "fs/promises";
import { join } from "path";
import {
  generateToken,
  isFileWorldOrGroupReadable,
  writeTokenToFile,
  ensureTokenFile,
  main,
} from "./token";

const TEST_DIR = "/tmp/ops-token-test";

describe("Token Generation", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it("generates a 64-character hex token (32 bytes)", () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token.length).toBe(64);
  });

  it("generates different tokens each time", () => {
    const token1 = generateToken();
    const token2 = generateToken();
    expect(token1).not.toBe(token2);
  });

  describe("File Permissions Check", () => {
    it("returns false when file does not exist", () => {
      const nonExistent = join(TEST_DIR, "nonexistent.token");
      expect(isFileWorldOrGroupReadable(nonExistent)).toBe(false);
    });

    it("returns false when file has mode 0600", async () => {
      const filePath = join(TEST_DIR, "token.txt");
      await writeFile(filePath, "test", { mode: 0o600 });
      expect(isFileWorldOrGroupReadable(filePath)).toBe(false);
    });

    it("returns true when file has group-readable bit set (0640)", async () => {
      const filePath = join(TEST_DIR, "token.txt");
      await writeFile(filePath, "test");
      await chmod(filePath, 0o640);
      expect(isFileWorldOrGroupReadable(filePath)).toBe(true);
    });

    it("returns true when file has world-readable bit set (0644)", async () => {
      const filePath = join(TEST_DIR, "token.txt");
      await writeFile(filePath, "test");
      await chmod(filePath, 0o644);
      expect(isFileWorldOrGroupReadable(filePath)).toBe(true);
    });

    it("returns true when file has both group and world readable (0666)", async () => {
      const filePath = join(TEST_DIR, "token.txt");
      await writeFile(filePath, "test");
      await chmod(filePath, 0o666);
      expect(isFileWorldOrGroupReadable(filePath)).toBe(true);
    });
  });

  describe("Writing Token File", () => {
    it("writes token to file with mode 0600", async () => {
      const filePath = join(TEST_DIR, "token.txt");
      const token = generateToken();
      await writeTokenToFile(filePath, token);

      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      expect(content).toBe(token);

      const stats = statSync(filePath);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("refuses to write if file has group-readable permissions", async () => {
      const filePath = join(TEST_DIR, "token.txt");
      await writeFile(filePath, "existing");
      await chmod(filePath, 0o640);

      const token = generateToken();
      expect(writeTokenToFile(filePath, token)).rejects.toThrow(
        /group or world-readable permissions/
      );
    });

    it("refuses to write if file has world-readable permissions", async () => {
      const filePath = join(TEST_DIR, "token.txt");
      await writeFile(filePath, "existing");
      await chmod(filePath, 0o644);

      const token = generateToken();
      expect(writeTokenToFile(filePath, token)).rejects.toThrow(
        /group or world-readable permissions/
      );
    });

    it("overwrites file if it has secure permissions (0600)", async () => {
      const filePath = join(TEST_DIR, "token.txt");
      const oldToken = generateToken();
      await writeTokenToFile(filePath, oldToken);

      const newToken = generateToken();
      await writeTokenToFile(filePath, newToken);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toBe(newToken);
      expect(content).not.toBe(oldToken);
    });
  });

  describe("ensureTokenFile", () => {
    it("creates new token file if it does not exist", async () => {
      const filePath = join(TEST_DIR, "token.txt");
      const token = await ensureTokenFile(filePath);

      expect(existsSync(filePath)).toBe(true);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(readFileSync(filePath, "utf-8")).toBe(token);
    });

    it("returns existing token if file already exists", async () => {
      const filePath = join(TEST_DIR, "token.txt");
      const originalToken = generateToken();
      await writeTokenToFile(filePath, originalToken);

      const token = await ensureTokenFile(filePath);
      expect(token).toBe(originalToken);
    });

    it("refuses to read token from file with group-readable permissions", async () => {
      const filePath = join(TEST_DIR, "token.txt");
      const originalToken = generateToken();
      await writeFile(filePath, originalToken);
      await chmod(filePath, 0o644);

      expect(ensureTokenFile(filePath)).rejects.toThrow(
        /group or world-readable permissions/
      );
    });

    it("creates parent directories if they do not exist", async () => {
      const filePath = join(TEST_DIR, "nonexistent", "nested", "dir", "token.txt");
      const token = await ensureTokenFile(filePath);

      expect(existsSync(filePath)).toBe(true);
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(readFileSync(filePath, "utf-8")).toBe(token);
    });

    it("creates parent directories with mode 0o700", async () => {
      const filePath = join(TEST_DIR, "parenttest", "token.txt");
      await ensureTokenFile(filePath);

      const parentDir = join(TEST_DIR, "parenttest");
      const stats = statSync(parentDir);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o700);
    });
  });

  describe("CLI with copy command", () => {
    it("calls copy function when --copy flag is provided", async () => {
      const filePath = join(TEST_DIR, "token.txt");
      let copyWasCalled = false;
      let copiedContent = "";

      // Mock the copy function
      const mockCopy = async (content: string) => {
        copyWasCalled = true;
        copiedContent = content;
      };

      await main([filePath, "--copy"], mockCopy);
      expect(copyWasCalled).toBe(true);
      expect(copiedContent).toMatch(/^[0-9a-f]{64}$/);
    });

    it("does not call copy function when --copy flag is not provided", async () => {
      const filePath = join(TEST_DIR, "token.txt");
      let copyWasCalled = false;

      // Mock the copy function
      const mockCopy = async (content: string) => {
        copyWasCalled = true;
      };

      await main([filePath], mockCopy);
      expect(copyWasCalled).toBe(false);
    });
  });
});
