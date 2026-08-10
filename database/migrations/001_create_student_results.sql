create extension if not exists pg_stat_statements;

create table if not exists student_results (
  id bigint generated always as identity primary key,
  student_id text not null,
  student_id_normalized text not null,
  student_name text not null,
  student_name_normalized text not null,
  father_name text not null,
  father_name_normalized text not null,
  academic_year text not null,
  score numeric(5, 2) not null,
  grade text not null,
  status text not null,
  created_at timestamptz not null default now(),
  constraint student_results_student_id_normalized_unique unique (student_id_normalized),
  constraint student_results_score_range check (score between 0 and 100),
  constraint student_results_status_valid check (status in ('pass', 'fail')),
  constraint student_results_nonempty_identity check (
    length(student_id_normalized) > 0
    and length(student_name_normalized) > 0
    and length(father_name_normalized) > 0
  )
);

comment on table student_results is
  'Synthetic student result records used only for architecture benchmarks.';

comment on column student_results.student_id_normalized is
  'Canonical lookup value. The unique constraint supplies the lookup B-tree index.';
