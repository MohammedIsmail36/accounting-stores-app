
-- Add is_system column to accounts table
ALTER TABLE public.accounts ADD COLUMN is_system boolean NOT NULL DEFAULT false;

-- Mark system accounts
UPDATE public.accounts SET is_system = true
WHERE code IN ('1101', '1102', '1103', '1104', '2101', '3101', '3102', '4101', '5101', '5201', '4201');
