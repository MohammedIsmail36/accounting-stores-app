-- Fix cancelled expenses whose original JE was incorrectly marked as cancelled.
-- The reverse JE is already 'posted', so making the original 'posted' will net them to zero.
UPDATE journal_entries
SET status = 'posted'
WHERE id IN (
  SELECT e.journal_entry_id
  FROM expenses e
  JOIN journal_entries je ON je.id = e.journal_entry_id
  WHERE e.status = 'cancelled' AND je.status = 'cancelled'
);