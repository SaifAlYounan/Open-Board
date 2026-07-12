# Electronic signatures on minutes

This document says exactly what a signature in this system proves, what it does
not prove, and what it would take to reach a *qualified* signature under eIDAS.
Read the limits section before you rely on this for anything that matters.

## What was wrong before (and why this exists)

The original signing code computed `sha256(content + signer name + timestamp)`
and stored the digest. Three separate problems:

- The hash was **unkeyed**. Anyone who could write to the database could compute
  a perfectly valid-looking one.
- The `timestamp` fed into the hash was a **local variable that was never
  stored**, so even an honest server could not recompute the digest afterwards.
- There was **no verifier**. Nothing ever checked the value again.

So the artifact with the most legal weight in the product — a director's
signature on the minutes — was the hollowest thing in it. That was audit finding
**F6**, and this is the fix.

## What happens now

**Enrollment (once per signer).** `POST /api/signing-keys` with a passphrase.
The server generates an **Ed25519** keypair, encrypts the private key with a key
derived from your passphrase (scrypt, N=32768, r=8, p=1 → AES-256-GCM), stores
only the ciphertext, and returns your public key **fingerprint**. The passphrase
is never stored. **Write the fingerprint down somewhere outside this system** —
the limits section explains why.

**Signing.** `POST /api/minutes/:id/sign` with your passphrase. The server
unwraps your private key in memory, signs, and drops it. It signs a canonical,
deterministic payload:

```
LQGovernance-Minutes-Signature-v1
minutesId:<uuid>
contentSha256:<sha256 of the minutes text>
signerId:<uuid>
signerName:<name attested at signing>
signedAt:<the exact instant that is also stored>
algorithm:Ed25519
publicKey:<the signer's public key>
```

Every field is persisted. The timestamp that is signed is the timestamp that is
stored — the F6 bug, precisely inverted.

**Verification.** Two ways, and they are independent:

- In app: `GET /api/minutes/:id/signature/verify` — returns `verified`,
  `invalid`, or `legacy_unverifiable` per signature (409 if any is `invalid`).
- Offline: `GET /api/minutes/:id/export` gives a self-contained bundle; then
  `node artifacts/api-server/scripts/verify-minutes.mjs bundle.json --fingerprint <hex>`. The
  verifier is a **separate implementation** that imports nothing from this
  application and needs no database — so a bug in the app's verifier cannot
  vouch for itself.

Signatures made before this change are reported `legacy_unverifiable`. They are
never reported as verified. They prove nothing, and saying so is the point.

## What a verified signature proves

1. **This exact text.** Change one character of the minutes and verification
   fails. The signature commits to the content hash.
2. **This signer's key.** A forged row in the database does not verify: producing
   a valid Ed25519 signature requires the private key.
3. **The operator did not sign for them.** The server never holds the plaintext
   private key. Not "does not use it" — *does not have it*. Even an administrator
   with full database access cannot sign as a director, because what is stored is
   ciphertext they cannot open.

That third property is *sole control*, and with (1) and (2) it is the substance
of an **advanced electronic signature** under eIDAS Article 26: uniquely linked
to the signer, capable of identifying them, created with means under their sole
control, and bound to the data such that any subsequent change is detectable.

## The limit you must understand

An adversary with **database write access** cannot forge a signature under your
key — but they *can replace the recorded public key with one of their own and
sign with that*. The signature would verify, against the wrong key.

Nothing inside the database can prevent this, because the attacker controls the
database. It is the same structural gap as a hash-chained audit log with no
external anchor: self-verification cannot survive an adversary who owns the
storage.

The gap closes only with a reference held **outside** the system:

- At enrollment you are shown a **fingerprint** of your public key. Record it
  (password manager, printed and filed, an email to yourself — anywhere the
  operator cannot silently rewrite).
- Verification with `--fingerprint <hex>` then checks that the key that signed is
  the key you enrolled. Without it, the offline verifier says so explicitly
  rather than implying a guarantee it cannot give.

An auditor's practical rule: **collect signer fingerprints out of band once, and
verify against them.**

## What would make these *qualified* (QES)

An advanced signature is not a qualified one. To reach QES under eIDAS you need
things that are procurement and process, not code:

- A **qualified trust service provider** issuing a qualified certificate that
  binds the key to a legally identified person (identity proofing we do not do —
  we bind to an account, and an account is only as good as the admin who created
  it).
- A **qualified signature creation device** (QSCD): certified hardware or a
  qualified remote signing service. A passphrase-wrapped key in a database is
  under the signer's sole control but is not a QSCD.
- A **qualified timestamp** from a TSA. Our `signedAt` is the server's clock, and
  a hostile operator can lie about it. The signature proves the content and the
  signer, not the hour, against that adversary.

If your board needs QES, the seam is deliberate: signing already goes through
`lib/signing.ts` with the key material behind one interface, so a TSP/QSCD
provider slots in there. **Alexios should confirm the legal requirement before
go-live** — advanced may well be sufficient for board minutes in the relevant
jurisdiction, and that is a lawyer's call, not an engineer's.

## Key loss and rotation

- **Lose the passphrase → lose the key.** The server cannot recover it; that is
  the same property that stops it signing for you. Revoke
  (`DELETE /api/signing-keys`) and enroll a new one.
- **Revoked keys still verify their past signatures.** A key retires; it does not
  vanish. Signatures made before revocation remain valid, which is what a
  historical record requires.
