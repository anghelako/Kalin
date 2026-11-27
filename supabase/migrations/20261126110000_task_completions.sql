-- Per-time completion for repeating tasks.
-- Run AFTER 20261126090000_task_schedule.sql. Safe to run more than once.

-- Earlier draft used a single last_done_on column; it is replaced by this table.
ALTER TABLE public.circle_tasks DROP COLUMN IF EXISTS last_done_on;

CREATE TABLE IF NOT EXISTS public.circle_task_completions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL,
  task_id uuid NOT NULL,
  slot_date date NOT NULL,
  slot_time time without time zone NOT NULL,
  done_by uuid DEFAULT auth.uid(),
  done_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT circle_task_completions_pkey PRIMARY KEY (id),
  CONSTRAINT circle_task_completions_slot_key UNIQUE (task_id, slot_date, slot_time),
  CONSTRAINT circle_task_completions_date_check CHECK (slot_date >= '0001-01-01' AND slot_date <= '9999-12-31'),
  CONSTRAINT circle_task_completions_circle_id_fkey FOREIGN KEY (circle_id) REFERENCES public.circles(id) ON DELETE CASCADE,
  CONSTRAINT circle_task_completions_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.circle_tasks(id) ON DELETE CASCADE,
  CONSTRAINT circle_task_completions_done_by_fkey FOREIGN KEY (done_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS circle_task_completions_circle_day
  ON public.circle_task_completions USING btree (circle_id, slot_date);

ALTER TABLE public.circle_task_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can read task completions" ON public.circle_task_completions;
CREATE POLICY "Members can read task completions" ON public.circle_task_completions
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.is_circle_member(circle_id));

DROP POLICY IF EXISTS "Members can add task completions" ON public.circle_task_completions;
CREATE POLICY "Members can add task completions" ON public.circle_task_completions
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.is_circle_member(circle_id)
    AND done_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.circle_tasks t
      WHERE t.id = circle_task_completions.task_id AND t.circle_id = circle_task_completions.circle_id
    )
  );

DROP POLICY IF EXISTS "Members can remove task completions" ON public.circle_task_completions;
CREATE POLICY "Members can remove task completions" ON public.circle_task_completions
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (public.is_circle_member(circle_id));

REVOKE ALL PRIVILEGES ON TABLE public.circle_task_completions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.circle_task_completions TO service_role;
GRANT SELECT, DELETE ON TABLE public.circle_task_completions TO authenticated;
GRANT INSERT (circle_id, task_id, slot_date, slot_time) ON TABLE public.circle_task_completions TO authenticated;
