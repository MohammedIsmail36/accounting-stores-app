ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check
  CHECK (action = ANY (ARRAY['INSERT','UPDATE','DELETE','reset_to_draft','repost','post','unpost','cancel']));