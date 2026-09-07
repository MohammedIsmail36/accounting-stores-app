-- Performance indexes for the Expenses module
CREATE INDEX IF NOT EXISTS idx_expenses_status ON public.expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON public.expenses(expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_expense_type_id ON public.expenses(expense_type_id);
CREATE INDEX IF NOT EXISTS idx_expenses_payment_method ON public.expenses(payment_method);
CREATE INDEX IF NOT EXISTS idx_expenses_journal_entry_id ON public.expenses(journal_entry_id);