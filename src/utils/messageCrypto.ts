import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const MESSAGE_ALGORITHM = "aes-256-gcm";
const NONCE_LENGTH = 12;

type EncodedKey = {
  id: string;
  bytes: Buffer;
};

type MessageKeyRing = {
  activeKeyId: string;
  keysById: Map<string, Buffer>;
};

export type EncryptedMessagePayload = {
  contentCiphertext: string;
  contentNonce: string;
  contentAuthTag: string;
  contentAlg: string;
  contentKeyId: string;
};

let cachedKeyRing: MessageKeyRing | null = null;

function decodeKey(input: string): Buffer {
  const value = input.trim();

  if (value.startsWith("base64:")) {
    return Buffer.from(value.slice("base64:".length), "base64");
  }

  if (value.startsWith("hex:")) {
    return Buffer.from(value.slice("hex:".length), "hex");
  }

  const base64Attempt = Buffer.from(value, "base64");
  if (base64Attempt.length === 32 && base64Attempt.toString("base64") === value) {
    return base64Attempt;
  }

  const hexAttempt = Buffer.from(value, "hex");
  if (hexAttempt.length === 32 && /^[0-9a-fA-F]+$/.test(value)) {
    return hexAttempt;
  }

  return Buffer.from(value, "utf8");
}

function parseKeyRingFromEnv(): EncodedKey[] {
  const keySpec = process.env.MESSAGE_ENCRYPTION_KEYS;
  if (keySpec && keySpec.trim().length > 0) {
    const entries = keySpec
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    if (entries.length === 0) {
      throw new Error("MESSAGE_ENCRYPTION_KEYS is set but contains no key entries");
    }

    return entries.map((entry) => {
      const idx = entry.indexOf("=");
      if (idx <= 0 || idx === entry.length - 1) {
        throw new Error(
          "Invalid MESSAGE_ENCRYPTION_KEYS entry. Expected format 'keyId=base64:...'."
        );
      }

      const id = entry.slice(0, idx).trim();
      const encoded = entry.slice(idx + 1).trim();
      const bytes = decodeKey(encoded);

      if (bytes.length !== 32) {
        throw new Error(
          `MESSAGE_ENCRYPTION_KEYS entry '${id}' must decode to 32 bytes for AES-256-GCM`
        );
      }

      return { id, bytes };
    });
  }

  const keyRaw = process.env.MESSAGE_ENCRYPTION_KEY;
  if (!keyRaw) {
    throw new Error(
      "MESSAGE_ENCRYPTION_KEY or MESSAGE_ENCRYPTION_KEYS is required for message encryption"
    );
  }

  const decoded = decodeKey(keyRaw);
  if (decoded.length !== 32) {
    throw new Error("MESSAGE_ENCRYPTION_KEY must decode to exactly 32 bytes for AES-256-GCM");
  }

  return [
    {
      id: process.env.MESSAGE_ENCRYPTION_KEY_ID ?? "v1",
      bytes: decoded,
    },
  ];
}

function getMessageKeyRing(): MessageKeyRing {
  if (cachedKeyRing) return cachedKeyRing;

  const keyList = parseKeyRingFromEnv();
  const keysById = new Map<string, Buffer>();

  for (const key of keyList) {
    if (!key.id) {
      throw new Error("Message encryption key id cannot be empty");
    }
    if (keysById.has(key.id)) {
      throw new Error(`Duplicate message encryption key id: ${key.id}`);
    }
    keysById.set(key.id, key.bytes);
  }

  const activeKeyId = process.env.MESSAGE_ENCRYPTION_KEY_ID ?? keyList[0].id;
  if (!keysById.has(activeKeyId)) {
    throw new Error(
      `MESSAGE_ENCRYPTION_KEY_ID '${activeKeyId}' is not present in MESSAGE_ENCRYPTION_KEYS`
    );
  }

  cachedKeyRing = {
    activeKeyId,
    keysById,
  };

  return cachedKeyRing;
}

export function validateMessageEncryptionConfig(): void {
  getMessageKeyRing();
}

export function buildMessageAad(channelId: number, userId: string): string {
  return `channel:${channelId}:user:${userId}`;
}

export function encryptMessageContent(content: string, aad: string): EncryptedMessagePayload {
  const keyRing = getMessageKeyRing();
  const activeKeyBytes = keyRing.keysById.get(keyRing.activeKeyId)!;
  const nonce = randomBytes(NONCE_LENGTH);

  const cipher = createCipheriv(MESSAGE_ALGORITHM, activeKeyBytes, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));

  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(content, "utf8")),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    contentCiphertext: ciphertext.toString("base64"),
    contentNonce: nonce.toString("base64"),
    contentAuthTag: authTag.toString("base64"),
    contentAlg: MESSAGE_ALGORITHM,
    contentKeyId: keyRing.activeKeyId,
  };
}

export function decryptMessageContent(
  payload: {
    contentCiphertext: string;
    contentNonce: string;
    contentAuthTag: string;
    contentAlg: string;
    contentKeyId: string;
  },
  aad: string
): string {
  const keyRing = getMessageKeyRing();

  if (payload.contentAlg !== MESSAGE_ALGORITHM) {
    throw new Error(`Unsupported message algorithm: ${payload.contentAlg}`);
  }

  const keyBytes = keyRing.keysById.get(payload.contentKeyId);
  if (!keyBytes) {
    throw new Error(`Unknown message key id: ${payload.contentKeyId}`);
  }

  const nonce = Buffer.from(payload.contentNonce, "base64");
  const authTag = Buffer.from(payload.contentAuthTag, "base64");
  const ciphertext = Buffer.from(payload.contentCiphertext, "base64");

  const decipher = createDecipheriv(MESSAGE_ALGORITHM, keyBytes, nonce);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
