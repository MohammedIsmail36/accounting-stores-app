
-- Create journal entries table
CREATE TABLE public.journal_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_number SERIAL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
  total_debit NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_credit NUMERIC(15,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create journal entry lines table
CREATE TABLE public.journal_entry_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  journal_entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id),
  debit NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit NUMERIC(15,2) NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;

-- RLS for journal_entries
CREATE POLICY "Authorized users can view journal entries"
ON public.journal_entries FOR SELECT
USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

CREATE POLICY "Authorized users can insert journal entries"
ON public.journal_entries FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

CREATE POLICY "Authorized users can update journal entries"
ON public.journal_entries FOR UPDATE
USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

CREATE POLICY "Admins can delete journal entries"
ON public.journal_entries FOR DELETE
USING (has_role(auth.uid(), 'admin'));

-- RLS for journal_entry_lines
CREATE POLICY "Authorized users can view journal entry lines"
ON public.journal_entry_lines FOR SELECT
USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

CREATE POLICY "Authorized users can insert journal entry lines"
ON public.journal_entry_lines FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

CREATE POLICY "Authorized users can update journal entry lines"
ON public.journal_entry_lines FOR UPDATE
USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

CREATE POLICY "Authorized users can delete journal entry lines"
ON public.journal_entry_lines FOR DELETE
USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'accountant'));

-- Trigger for updated_at
CREATE TRIGGER update_journal_entries_updated_at
BEFORE UPDATE ON public.journal_entries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Index for performance
CREATE INDEX idx_journal_entry_lines_entry_id ON public.journal_entry_lines(journal_entry_id);
CREATE INDEX idx_journal_entry_lines_account_id ON public.journal_entry_lines(account_id);
CREATE INDEX idx_journal_entries_date ON public.journal_entries(entry_date);
CREATE INDEX idx_journal_entries_status ON public.journal_entries(status);
