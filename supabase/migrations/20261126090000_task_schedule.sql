-- Tasks get the same scheduling fields as medication schedules.
-- due_date stays and now means "Starts", so Home's due/overdue logic keeps working.
ALTER TABLE public.circle_tasks
  ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT 'once',
  ADD COLUMN IF NOT EXISTS days_of_week smallint[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS interval_days smallint,
  ADD COLUMN IF NOT EXISTS times time without time zone[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS end_date date,
  ADD COLUMN IF NOT EXISTS instructions text;

ALTER TABLE public.circle_tasks
  ADD CONSTRAINT circle_tasks_frequency_check CHECK (frequency = ANY (ARRAY['once','daily','weekly','interval'])),
  ADD CONSTRAINT circle_tasks_times_check CHECK (cardinality(times) <= 8),
  ADD CONSTRAINT circle_tasks_weekly_check CHECK (frequency <> 'weekly' OR cardinality(days_of_week) BETWEEN 1 AND 7),
  ADD CONSTRAINT circle_tasks_interval_check CHECK (frequency <> 'interval' OR (interval_days BETWEEN 2 AND 60)),
  ADD CONSTRAINT circle_tasks_end_date_check CHECK (end_date IS NULL OR due_date IS NULL OR end_date >= due_date),
  ADD CONSTRAINT circle_tasks_instructions_check CHECK (char_length(instructions) <= 200);

GRANT INSERT (frequency, days_of_week, interval_days, times, end_date, instructions)
  ON TABLE public.circle_tasks TO authenticated;
GRANT UPDATE (frequency, days_of_week, interval_days, times, end_date, instructions)
  ON TABLE public.circle_tasks TO authenticated;
