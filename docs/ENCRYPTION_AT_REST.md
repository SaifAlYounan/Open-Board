# Application-level encryption at rest — execution plan

**Status: NOT IMPLEMENTED.** OpenBoard today relies on operator-provided full-disk
encryption only. This document is a complete, self-contained plan to add
application-level envelope encryption for confidential content. Hand it to a
capable coding agent (e.g. Claude Code) or follow it by hand. Do the phases in
order; each ends with an acceptance test that must fail before and pass after.

> Read Part 0 and Part 6 before writing code. Part 0 says what this does and does
> not buy — if the deployment's threat is a fully-compromised app process, this is
> not your control. Part 6 is a decision the maintainer must make (KEK custody).

---

## Part 0. What this buys, and what it does not

Envelope encryption here protects **confidentiality of data at rest** against:

- a stolen or dumped database (`pg_dump`, a leaked backup, a compromised replica);
- a stolen uploads volume or file backup;
- a hosting provider or subpoena reaching the storage layer only.

It does **NOT** protect against:

- a fully-compromised application process — it holds the key-encryption key (KEK)
  and can decrypt on demand;
- a compromised KEK (whoever holds the KEK holds the data);
- traffic in flight (that is TLS's job) or data in the model provider's hands
  (that is the AI-boundary control, `AI_ALLOW_EXTERNAL_PROVIDER`).

State this honestly in `SECURITY.md`. Encryption at rest narrows the blast radius;
it is not a universal confidentiality guarantee.

---

## Part 1. Scope — what gets encrypted

Encrypt the confidential payloads, not structural metadata (ids, timestamps,
board/person foreign keys, status enums — these must stay queryable and are not
themselves sensitive).

| Data | Where today | Encrypt? |
|---|---|---|
| Uploaded document bytes | files on disk under `UPLOADS_DIR` (`lib/extractText.ts`) | **Yes** |
| Minutes body | `minutes.content` (`lib/db/src/schema/minutes.ts`) | **Yes** |
| Resolution text | `votes.resolution_text` | **Yes** |
| AI classification / summaries / flagged passages | `documents.ai_classification` (jsonb), any stored summary | **Yes** |
| Extracted document text (if persisted for P0.5) | new column | **Yes** |
| Titles, filenames, resolution numbers | various | No (needed for lists/search; low sensitivity) — decide per deployment |
| Audit `details` | `audit_trail.details` | Optional — encrypting breaks the hash chain's stable hashing; if required, hash the ciphertext, not the plaintext |

---

## Part 2. Design — envelope encryption

- **DEK (data encryption key):** a fresh 256-bit key per encrypted object (per
  document, per minutes row). Used with **AES-256-GCM** (authenticated; store the
  12-byte IV and 16-byte auth tag alongside the ciphertext).
- **KEK (key-encryption key):** one key that wraps every DEK. Held **outside the
  database** (see Part 6). The DB only ever stores DEKs *wrapped* by the KEK.
- **Envelope:** to write, generate a DEK, encrypt the payload with it, wrap the
  DEK with the KEK, store `{ciphertext, iv, tag, wrappedDek, kekId}`. To read,
  unwrap the DEK with the KEK, decrypt.

Use Node's built-in `crypto` (`createCipheriv('aes-256-gcm', …)`). **Do not add a
crypto dependency** — the standard library is sufficient and auditable.

Create one module, `artifacts/api-server/src/lib/crypto.ts`, exposing:

```ts
export interface Sealed { v: 1; kekId: string; wrappedDek: string; iv: string; tag: string; ciphertext: string } // all base64
export function seal(plaintext: Buffer | string): Sealed      // generate DEK, encrypt, wrap DEK
export function open(sealed: Sealed): Buffer                    // unwrap DEK, decrypt (throws on auth-tag mismatch)
export function kekAvailable(): boolean                         // false when the KEK is not loaded
```

Persist a `Sealed` as a single jsonb column (or a text column of `JSON.stringify`).
`v` and `kekId` make rotation and format migration possible.

---

## Part 3. Schema and migration

For each encrypted field, add a nullable `*_enc jsonb` column beside the plaintext
column; do NOT drop the plaintext column until backfill + cutover is verified.

Representative changes (`lib/db/src/schema/*.ts`, then `pnpm --filter @workspace/db
run generate` — note the migrations README: `out` must be relative):

- `minutes`: add `content_enc jsonb`.
- `votes`: add `resolution_text_enc jsonb`.
- `documents`: add `ai_classification_enc jsonb`; store file ciphertext on disk
  (the file itself becomes a `Sealed` JSON, or keep the envelope sidecar).

Backfill migration (data): for every existing row, `seal()` the plaintext into the
`_enc` column. This requires the app's KEK, so run it as a one-off script
(`artifacts/api-server/scripts/encrypt-backfill.mjs`) against a live KEK, NOT as a
pure SQL migration.

Cutover: switch reads/writes to the `_enc` columns (Part 4), verify, then a later
migration nulls/drops the plaintext columns.

---

## Part 4. Read/write path changes

- **Writes:** wherever a confidential field is written (`routes/minutes.ts` save,
  `routes/documents.ts` upload, `pendingActions.ts` vote creation), call `seal()`
  and store the envelope; stop writing the plaintext column.
- **Reads:** wherever it is read back for display/download, call `open()`. For
  document download (`routes/documents.ts` `/documents/:id/download`), decrypt to
  a stream/buffer and serve with the existing `Content-Disposition: attachment`.
- **Files on disk:** on upload, `seal()` the file bytes and write the envelope to
  `UPLOADS_DIR`; on download, read + `open()`. Never leave a decrypted temp file.
- **Fail closed:** if `kekAvailable()` is false, any route needing decryption
  returns **503** (`{ error: "Encryption key unavailable" }`) — never a plaintext
  fallback, never a 500 that leaks internals. Add a boot check that logs loudly
  when the KEK is absent.

---

## Part 5. Key rotation

- Rotating the **KEK**: unwrap each DEK with the old KEK, re-wrap with the new KEK,
  update `kekId`. The payload ciphertext (DEK-encrypted) is untouched, so rotation
  is cheap — only the small `wrappedDek` changes. Provide
  `scripts/rotate-kek.mjs` that walks every `Sealed` and re-wraps.
- Rotating a **DEK** (e.g. suspected exposure of one object): `open()` then
  `seal()` that object with a fresh DEK.
- Keep old KEKs available for unwrap until every envelope is re-wrapped (`kekId`
  selects which KEK to use).

---

## Part 6. KEK custody — the decision the maintainer must make

Ordered weakest→strongest; ship the seam so you can move up without re-encrypting
payloads (only re-wrap DEKs):

1. **Key file outside the DB volume** (minimum). KEK in a file the app reads at
   boot (`KEK_FILE=/etc/openboard/kek`), on a volume separate from Postgres and
   backups. Defends against a DB dump / backup theft. Does NOT defend against a
   host compromise that reads the app's filesystem.
2. **Environment-injected KEK via a secrets manager** (Vault, cloud secret store)
   — the KEK never lands on disk; the orchestrator injects it. Better operational
   hygiene, same cryptographic strength as (1) once loaded.
3. **KMS / HSM** (target). The KEK never leaves the KMS/HSM; wrap/unwrap happen via
   the KMS API. Defends against app-disk compromise for the KEK itself. Requires
   cloud infra + credentials the operator provisions; build against the KMS wrap/
   unwrap API behind the same `crypto.ts` seam.

`crypto.ts` must abstract wrap/unwrap so (1)→(3) is a config change, not a rewrite.

---

## Part 7. Acceptance tests (fail before, pass after)

1. **Nothing readable at rest:** with encryption enabled, `pg_dump` of the database
   and `tar` of `UPLOADS_DIR` contain **no** readable minutes text, document
   content, resolution text, or flagged passages (grep the dump for a known
   marker string that was written through the app — it must be absent).
2. **Round-trip:** a document uploaded and a minutes body saved through the API
   read back byte-identical after `seal`/`open`.
3. **Tamper detection:** flipping one byte of a stored `ciphertext` makes `open()`
   throw (GCM auth-tag mismatch), and the route returns 503/500 cleanly, never
   plaintext.
4. **Fail closed:** with the KEK unavailable, every decrypt route returns 503 and
   no plaintext is emitted; writes that need `seal()` also refuse.
5. **Rotation:** after `rotate-kek.mjs`, every object still `open()`s and test 1
   still holds.

---

## Part 8. How not to do this

- Do not invent a cipher or use ECB / unauthenticated modes — AES-256-GCM only.
- Do not store the KEK in the database, in the repo, or in `.env` committed to git.
- Do not add a plaintext fallback "for convenience" when the KEK is missing.
- Do not drop the plaintext columns until backfill + cutover are proven on a copy
  of production data.
- Do not claim "encrypted at rest" in `README.md`/`SECURITY.md` until tests 1–5
  pass; until then, the honest statement is operator-provided full-disk only.
