-- Allow 'cancelled' status in journal_entries
ALTER TABLE public.journal_entries DROP CONSTRAINT journal_entries_status_check;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_status_check CHECK (status = ANY (ARRAY['draft'::text, 'posted'::text, 'cancelled'::text]));