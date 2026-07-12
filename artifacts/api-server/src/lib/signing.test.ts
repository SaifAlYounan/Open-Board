import { describe, expect, it } from "vitest";
import {
  canonicalPayload,
  generateWrappedKeypair,
  unwrapPrivateKey,
  signPayload,
  verifyPayload,
  verifySignatureRow,
  publicKeyFingerprint,
  sha256Hex,
  PAYLOAD_VERSION,
  WrongPassphraseError,
  type SignaturePayload,
} from "./signing";

const PASSPHRASE = "a-long-enough-signing-passphrase";

function payload(over: Partial<SignaturePayload> = {}): SignaturePayload {
  return {
    minutesId: "11111111-1111-4111-8111-111111111111",
    contentSha256: sha256Hex("<p>The minutes.</p>"),
    signerId: "22222222-2222-4222-8222-222222222222",
    signerName: "Jane Director",
    signedAt: "2026-07-12T10:00:00.000Z",
    algorithm: "Ed25519",
    publicKey: "PUBKEY",
    ...over,
  };
}

describe("canonical payload is injective (no two records serialize alike)", () => {
  it("escapes values, so a newline in a field cannot fake a field boundary", () => {
    // The attack: a signer name that impersonates the NEXT field. Without
    // escaping, this would serialize identically to an honest payload signed at
    // a different time — one signature, two meanings.
    const spoofed = canonicalPayload(
      payload({ signerName: 'Bob"\nsignedAt:"1999-01-01T00:00:00.000Z' }),
    );
    const honest = canonicalPayload(payload({ signerName: "Bob", signedAt: "1999-01-01T00:00:00.000Z" }));
    expect(spoofed).not.toBe(honest);
    // The escaped form keeps exactly one line per field.
    expect(honest.split("\n")).toHaveLength(8);
    expect(spoofed.split("\n")).toHaveLength(8);
  });

  it("changing any single field changes the bytes", () => {
    const base = canonicalPayload(payload());
    const fields: Array<Partial<SignaturePayload>> = [
      { minutesId: "99999999-9999-4999-8999-999999999999" },
      { contentSha256: sha256Hex("tampered") },
      { signerId: "99999999-9999-4999-8999-999999999999" },
      { signerName: "Someone Else" },
      { signedAt: "2020-01-01T00:00:00.000Z" },
      { publicKey: "OTHERKEY" },
    ];
    for (const f of fields) {
      expect(canonicalPayload(payload(f))).not.toBe(base);
    }
  });

  it("pins the version string — a format change must bump it", () => {
    expect(canonicalPayload(payload()).split("\n")[0]).toBe(PAYLOAD_VERSION);
  });
});

describe("key wrapping — the server cannot sign without the passphrase", () => {
  it("wraps, unwraps, signs, and verifies", () => {
    const wrapped = generateWrappedKeypair(PASSPHRASE);
    expect(wrapped.fingerprint).toBe(publicKeyFingerprint(wrapped.publicKey));

    const priv = unwrapPrivateKey(wrapped, PASSPHRASE);
    const p = payload({ publicKey: wrapped.publicKey });
    const sig = signPayload(priv, p);

    expect(verifyPayload(p, sig, wrapped.publicKey)).toBe(true);
  });

  it("a wrong passphrase fails on the auth tag — not a partial decrypt", () => {
    const wrapped = generateWrappedKeypair(PASSPHRASE);
    expect(() => unwrapPrivateKey(wrapped, "wrong-passphrase")).toThrow(WrongPassphraseError);
  });

  it("a signature does not verify under a different key", () => {
    const a = generateWrappedKeypair(PASSPHRASE);
    const b = generateWrappedKeypair(PASSPHRASE);
    const p = payload({ publicKey: a.publicKey });
    const sig = signPayload(unwrapPrivateKey(a, PASSPHRASE), p);
    expect(verifyPayload(p, sig, b.publicKey)).toBe(false);
  });

  it("two enrollments never produce the same key", () => {
    const a = generateWrappedKeypair(PASSPHRASE);
    const b = generateWrappedKeypair(PASSPHRASE);
    expect(a.publicKey).not.toBe(b.publicKey);
    expect(a.kdfSalt).not.toBe(b.kdfSalt);
    expect(a.cipherIv).not.toBe(b.cipherIv);
  });
});

describe("verifySignatureRow", () => {
  const content = "<p>The minutes.</p>";

  function signedRow(over: Record<string, unknown> = {}) {
    const wrapped = generateWrappedKeypair(PASSPHRASE);
    const signedAt = new Date("2026-07-12T10:00:00.000Z");
    const p = payload({
      contentSha256: sha256Hex(content),
      signedAt: signedAt.toISOString(),
      publicKey: wrapped.publicKey,
    });
    const signature = signPayload(unwrapPrivateKey(wrapped, PASSPHRASE), p);
    return {
      signature,
      algorithm: "Ed25519",
      publicKey: wrapped.publicKey,
      contentSha256: p.contentSha256,
      signerName: p.signerName,
      personId: p.signerId,
      minutesId: p.minutesId,
      signedAt,
      payloadVersion: PAYLOAD_VERSION,
      ...over,
    };
  }

  it("verifies an honest signature", () => {
    expect(verifySignatureRow(signedRow(), content).status).toBe("verified");
  });

  it("rejects an edit to the content", () => {
    const r = verifySignatureRow(signedRow(), content.replace("minutes", "minute"));
    expect(r.status).toBe("invalid");
    expect(r.reason).toContain("changed since it was signed");
  });

  it("rejects a changed signer id", () => {
    const r = verifySignatureRow(
      signedRow({ personId: "33333333-3333-4333-8333-333333333333" }),
      content,
    );
    expect(r.status).toBe("invalid");
  });

  it("rejects a changed signing time", () => {
    const r = verifySignatureRow(signedRow({ signedAt: new Date("2026-07-13T10:00:00.000Z") }), content);
    expect(r.status).toBe("invalid");
  });

  it("rejects a garbage signature", () => {
    const r = verifySignatureRow(signedRow({ signature: Buffer.from("nope").toString("base64") }), content);
    expect(r.status).toBe("invalid");
  });

  it("reports a pre-P0.1 row as legacy_unverifiable — never verified", () => {
    const r = verifySignatureRow(
      {
        signature: null,
        algorithm: null,
        publicKey: null,
        contentSha256: null,
        signerName: null,
        personId: "22222222-2222-4222-8222-222222222222",
        minutesId: "11111111-1111-4111-8111-111111111111",
        signedAt: new Date(),
        payloadVersion: null,
      },
      content,
    );
    expect(r.status).toBe("legacy_unverifiable");
  });

  it("rejects an unknown payload version rather than guessing", () => {
    const r = verifySignatureRow(signedRow({ payloadVersion: "some-other-format-v9" }), content);
    expect(r.status).toBe("invalid");
    expect(r.reason).toContain("payload version");
  });
});
