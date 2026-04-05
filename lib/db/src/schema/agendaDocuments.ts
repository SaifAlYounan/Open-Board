import { pgTable, uuid, primaryKey } from "drizzle-orm/pg-core";
import { agendaItemsTable } from "./agendaItems";
import { documentsTable } from "./documents";

export const agendaDocumentsTable = pgTable("agenda_documents", {
  agendaItemId: uuid("agenda_item_id").references(() => agendaItemsTable.id, { onDelete: "cascade" }),
  documentId: uuid("document_id").references(() => documentsTable.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.agendaItemId, t.documentId] }),
}));
