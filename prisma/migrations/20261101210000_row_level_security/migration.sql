-- The API sets these transaction-local settings in withDatabaseAccess; policies add a
-- second authorization boundary. They only bind roles without SUPERUSER or BYPASSRLS.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Client', 'LegalCase', 'Hearing', 'Message', 'Task', 'AuditLog',
    'Document', 'DocumentPage', 'Judgment', 'LegalDraft', 'Conversation', 'ChatMessage', 'ConsultationRequest']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
END $$;

CREATE FUNCTION app_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('app.user_role', true) $$;
CREATE FUNCTION app_user() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('app.user_id', true) $$;

CREATE POLICY client_read ON "Client" FOR SELECT USING (
  app_role() IN ('SENIOR_LAWYER', 'SECRETARY')
  OR ("userId" = app_user() AND app_role() = 'CLIENT')
  OR (
    app_role() = 'TRAINEE_LAWYER'
    AND EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc."clientId" = "Client".id)
  )
);
CREATE POLICY client_create ON "Client" FOR INSERT WITH CHECK (app_role() IN ('SENIOR_LAWYER', 'SECRETARY'));
CREATE POLICY client_update ON "Client" FOR UPDATE USING (app_role() IN ('SENIOR_LAWYER', 'SECRETARY'));

-- case_read must not query "Client": client_read already queries "LegalCase", and a
-- cycle between two policies fails every query with "infinite recursion detected".
-- Add client-portal access through a denormalized column when that portal is built.
CREATE POLICY case_read ON "LegalCase" FOR SELECT USING (
  app_role() IN ('SENIOR_LAWYER', 'SECRETARY')
  OR (app_role() = 'TRAINEE_LAWYER' AND app_user() IN ("assignedLawyerId", "traineeLawyerId"))
);
CREATE POLICY case_create ON "LegalCase" FOR INSERT WITH CHECK (app_role() = 'SENIOR_LAWYER');
CREATE POLICY case_update ON "LegalCase" FOR UPDATE USING (app_role() = 'SENIOR_LAWYER')
  WITH CHECK (app_role() = 'SENIOR_LAWYER');

CREATE POLICY hearing_read ON "Hearing" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "Hearing"."caseId")
);
CREATE POLICY hearing_create ON "Hearing" FOR INSERT WITH CHECK (app_role() IN ('SENIOR_LAWYER', 'SECRETARY'));
CREATE POLICY hearing_update ON "Hearing" FOR UPDATE USING (app_role() IN ('SENIOR_LAWYER', 'SECRETARY'));

CREATE POLICY message_read ON "Message" FOR SELECT USING (
  app_role() IN ('SENIOR_LAWYER', 'SECRETARY')
  OR (
    app_role() = 'TRAINEE_LAWYER'
    AND EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc."clientId" = "Message"."clientId")
  )
);
CREATE POLICY message_create ON "Message" FOR INSERT WITH CHECK (
  app_role() IN ('SENIOR_LAWYER', 'TRAINEE_LAWYER', 'SECRETARY') AND "status" = 'DRAFT'
);
-- Approval is reserved for the senior lawyer; others may only edit, cancel or log a send.
CREATE POLICY message_update ON "Message" FOR UPDATE
  USING (app_role() IN ('SENIOR_LAWYER', 'TRAINEE_LAWYER', 'SECRETARY'))
  WITH CHECK (app_role() = 'SENIOR_LAWYER' OR "status" IN ('DRAFT', 'CANCELLED', 'SENT'));

CREATE POLICY task_read ON "Task" FOR SELECT USING (
  "assigneeId" = app_user() OR app_role() IN ('SENIOR_LAWYER', 'SECRETARY')
);
CREATE POLICY task_create ON "Task" FOR INSERT WITH CHECK (
  "assigneeId" = app_user() OR app_role() IN ('SENIOR_LAWYER', 'SECRETARY')
);
CREATE POLICY task_update ON "Task" FOR UPDATE USING (
  "assigneeId" = app_user() OR app_role() IN ('SENIOR_LAWYER', 'SECRETARY')
);

CREATE POLICY document_read ON "Document" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "Document"."caseId")
);
CREATE POLICY document_create ON "Document" FOR INSERT WITH CHECK (
  "uploadedById" = app_user() AND EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "Document"."caseId")
);
CREATE POLICY document_update ON "Document" FOR UPDATE USING (app_role() IN ('SENIOR_LAWYER', 'SECRETARY'));

CREATE POLICY document_page_read ON "DocumentPage" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "Document" d WHERE d.id = "DocumentPage"."documentId")
);
CREATE POLICY document_page_create ON "DocumentPage" FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM "Document" d WHERE d.id = "DocumentPage"."documentId")
);

CREATE POLICY judgment_read ON "Judgment" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "Judgment"."caseId")
);
CREATE POLICY judgment_create ON "Judgment" FOR INSERT WITH CHECK (app_role() = 'SENIOR_LAWYER');
CREATE POLICY judgment_update ON "Judgment" FOR UPDATE USING (app_role() = 'SENIOR_LAWYER');

CREATE POLICY draft_read ON "LegalDraft" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "LegalDraft"."caseId")
);
CREATE POLICY draft_create ON "LegalDraft" FOR INSERT WITH CHECK (
  "createdById" = app_user() AND "status" = 'DRAFT'
  AND EXISTS (SELECT 1 FROM "LegalCase" lc WHERE lc.id = "LegalDraft"."caseId")
);
-- Only the senior lawyer can approve; an author can keep editing an unapproved draft.
CREATE POLICY draft_update ON "LegalDraft" FOR UPDATE
  USING (app_role() = 'SENIOR_LAWYER' OR ("createdById" = app_user() AND "status" = 'DRAFT'))
  WITH CHECK (app_role() = 'SENIOR_LAWYER' OR ("status" = 'DRAFT' AND "reviewedById" IS NULL));

CREATE POLICY conversation_owner ON "Conversation" FOR ALL
  USING ("userId" = app_user()) WITH CHECK ("userId" = app_user());
CREATE POLICY chat_message_owner ON "ChatMessage" FOR ALL
  USING (EXISTS (SELECT 1 FROM "Conversation" c WHERE c.id = "ChatMessage"."conversationId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Conversation" c WHERE c.id = "ChatMessage"."conversationId"));

-- The public site inserts requests without a session, but can never read them back.
CREATE POLICY consultation_public_create ON "ConsultationRequest" FOR INSERT WITH CHECK ("status" = 'NEW');
CREATE POLICY consultation_read ON "ConsultationRequest" FOR SELECT USING (app_role() IN ('SENIOR_LAWYER', 'SECRETARY'));
CREATE POLICY consultation_update ON "ConsultationRequest" FOR UPDATE USING (app_role() IN ('SENIOR_LAWYER', 'SECRETARY'));

CREATE POLICY audit_insert ON "AuditLog" FOR INSERT WITH CHECK ("userId" = app_user());
CREATE POLICY audit_read ON "AuditLog" FOR SELECT USING (app_role() = 'SENIOR_LAWYER' OR "userId" = app_user());

CREATE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Audit log entries are immutable';
END;
$$;
CREATE TRIGGER audit_no_update_delete
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
