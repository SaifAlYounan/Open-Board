// Orval maintains this workspace barrel: it re-exports the zod contracts
// (generated/api — runtime validators whose types come via z.infer) and the
// plain TS component types (generated/types). The component types carry a
// "Model" suffix (see orval.config.ts override.components.schemas.suffix), so
// the two star-exports can never collide (the old TS2308 problem, issue #12).
export * from "./generated/api";
export * from "./generated/types";
