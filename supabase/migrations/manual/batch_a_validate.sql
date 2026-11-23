-- Manual follow-up. Run after reviewing the existing schedules against INT-05.
-- Both validations succeed together or the transaction rolls back.
BEGIN;
ALTER TABLE public.medication_schedules
  VALIDATE CONSTRAINT medication_schedules_batch_a_weekdays,
  VALIDATE CONSTRAINT medication_schedules_batch_a_times;
COMMIT;
