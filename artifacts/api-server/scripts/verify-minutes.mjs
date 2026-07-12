#!/usr/bin/env node
/**
 * Offline verifier for a signed-minutes bundle (P0.1 / F6).
 *
 *   node artifacts/api-server/scripts/verify-minutes.mjs minutes-<id>-signed.json [--fingerprint <hex>]...
 *
 * Takes the bundle from `GET /api/minutes/:id/export` and verifies it with NO
 * database, NO server, and no code from this application: it re-derives the
 * canonical payload from the bundle's own fields and checks each Ed25519
 * signature with Node's standard crypto. That independence is the point — a bug
 * in the application's verifier cannot vouch for itself.
 *
 * WHAT A PASS MEANS: the signer's key signed exactly this text at exactly this
 * time, and the server never held that key, so it could not have signed for
 * them.
 *
 * WHAT A PASS DOES NOT MEAN: that the public key in the bundle is really the
 * signer's. An operator with database write access could have substituted their
 * own key and re-signed. Pass `--fingerprint <hex>` (the value the signer
 * recorded out of band at enrollment) to close that gap — the exit code then
 * also depends on the keys matching. See docs/SIGNING.md.
 *
 * Exit 0 = every signature verified (and every supplied fingerprint matched).
 * Exit 1 = something did not verify. Exit 2 = the bundle could not be read.
 */
import { readFileSync } from "node:fs";
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";

const PAYLOAD_VERSION = "LQGovernance-Minutes-Signature-v1";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const expectedFingerprints = new Set();
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--fingerprint" && args[i + 1]) expectedFingerprints.add(args[i + 1].toLowerCase());
}

if (!file) {
  console.error("usage: verify-minutes.mjs <bundle.json> [--fingerprint <hex>]...");
  process.exit(2);
}

let bundle;
try {
  bundle = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.error(`Could not read ${file}: ${err.message}`);
  process.exit(2);
}

const sha256Hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// Rebuilt here from the spec, NOT imported from the app.
// Values are JSON-escaped so the encoding is injective: a value containing a
// newline cannot fake a field boundary and make two different records serialize
// to the same bytes.
const field = (name, value) => `${name}:${JSON.stringify(value ?? "")}`;
const canonicalPayload = (p) =>
  [
    PAYLOAD_VERSION,
    field("minutesId", p.minutesId),
    field("contentSha256", p.contentSha256),
    field("signerId", p.signerId),
    field("signerName", p.signerName),
    field("signedAt", p.signedAt),
    field("algorithm", p.algorithm),
    field("publicKey", p.publicKey),
  ].join("\n");

const content = bundle?.minutes?.content;
if (typeof content !== "string") {
  console.error("Bundle has no minutes.content — nothing to verify.");
  process.exit(2);
}

const liveHash = sha256Hex(content);
console.log(`Minutes:        ${bundle.minutes.id}`);
console.log(`Content sha256: ${liveHash}`);
if (bundle.minutes.contentSha256 && bundle.minutes.contentSha256 !== liveHash) {
  console.log(`  ! bundle's own contentSha256 (${bundle.minutes.contentSha256}) does not match its content`);
}
console.log("");

const sigs = Array.isArray(bundle.signatures) ? bundle.signatures : [];
if (sigs.length === 0) {
  console.log("No signatures in this bundle.");
  process.exit(1);
}

let bad = 0;
let verified = 0;

for (const s of sigs) {
  const who = `${s.signerName ?? "(unnamed)"} <${s.signerId ?? "?"}>`;

  if (!s.signature || !s.publicKey || !s.algorithm) {
    console.log(`LEGACY   ${who} — signed before cryptographic signing existed; unverifiable.`);
    bad++;
    continue;
  }
  if (s.payloadVersion !== PAYLOAD_VERSION) {
    console.log(`INVALID  ${who} — unknown payload version ${s.payloadVersion}`);
    bad++;
    continue;
  }
  if (s.algorithm !== "Ed25519") {
    console.log(`INVALID  ${who} — unsupported algorithm ${s.algorithm}`);
    bad++;
    continue;
  }
  if (s.contentSha256 !== liveHash) {
    console.log(`INVALID  ${who} — the minutes text changed after signing.`);
    bad++;
    continue;
  }

  let ok = false;
  try {
    const key = createPublicKey({
      key: Buffer.from(s.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    const payload = canonicalPayload({
      minutesId: bundle.minutes.id,
      contentSha256: s.contentSha256,
      signerId: s.signerId,
      signerName: s.signerName,
      signedAt: s.signedAt,
      algorithm: s.algorithm,
      publicKey: s.publicKey,
    });
    ok = cryptoVerify(null, Buffer.from(payload, "utf8"), key, Buffer.from(s.signature, "base64"));
  } catch (err) {
    console.log(`INVALID  ${who} — ${err.message}`);
    bad++;
    continue;
  }

  if (!ok) {
    console.log(`INVALID  ${who} — signature does not verify over the signed data.`);
    bad++;
    continue;
  }

  const fp = createHash("sha256").update(Buffer.from(s.publicKey, "base64")).digest("hex");
  if (expectedFingerprints.size > 0 && !expectedFingerprints.has(fp)) {
    console.log(`SUSPECT  ${who} — signature is cryptographically valid, but its key fingerprint`);
    console.log(`         ${fp}`);
    console.log(`         is not one you supplied. The recorded public key may have been swapped.`);
    bad++;
    continue;
  }

  console.log(`VERIFIED ${who}`);
  console.log(`         signed ${s.signedAt}, key ${fp.slice(0, 16)}…`);
  verified++;
}

console.log("");
console.log(`${verified} verified, ${bad} not verified, of ${sigs.length} signature(s).`);
if (expectedFingerprints.size === 0) {
  console.log("");
  console.log("NOTE: no --fingerprint given, so this run cannot detect a swapped public key.");
  console.log("      Ask each signer for the fingerprint they recorded at enrollment.");
}

process.exit(bad > 0 ? 1 : 0);
