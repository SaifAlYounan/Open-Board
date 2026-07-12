-- P0.7/A6 (data migration, no schema change). Remove redundant member-snapshot
-- grants: an access_control grant is redundant when the grantee is a CURRENT
-- member of the entity's board, because live membership already grants access —
-- the row would only outlive membership (the deprovisioning leak). Deny rows and
-- grants to non-members (e.g. a board-less document's uploader, a task assignee
-- who is not on the board) are kept. No-op on a fresh database.
DELETE FROM "access_control" ac
USING "board_memberships" bm
WHERE ac."has_access" = true
  AND bm."person_id" = ac."person_id"
  AND bm."board_id" = (
    CASE ac."entity_type"
      WHEN 'document' THEN (SELECT "board_id" FROM "documents" WHERE "id" = ac."entity_id")
      WHEN 'vote'     THEN (SELECT "board_id" FROM "votes"     WHERE "id" = ac."entity_id")
      WHEN 'meeting'  THEN (SELECT "board_id" FROM "meetings"  WHERE "id" = ac."entity_id")
      WHEN 'task'     THEN (SELECT "board_id" FROM "tasks"     WHERE "id" = ac."entity_id")
      WHEN 'minutes'  THEN (SELECT m."board_id" FROM "meetings" m JOIN "minutes" mi ON mi."meeting_id" = m."id" WHERE mi."id" = ac."entity_id")
    END
  );
