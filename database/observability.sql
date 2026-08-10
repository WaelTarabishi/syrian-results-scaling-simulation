-- Run with: docker compose exec postgres psql -U benchmark -d results_benchmark -f /dev/stdin < database/observability.sql
select
  calls,
  round(total_exec_time::numeric, 2) as total_exec_time_ms,
  round(mean_exec_time::numeric, 2) as mean_exec_time_ms,
  rows,
  query
from pg_stat_statements
where query ilike '%student_results%'
order by total_exec_time desc;

select state, wait_event_type, wait_event, count(*)
from pg_stat_activity
where datname = current_database()
group by state, wait_event_type, wait_event
order by count(*) desc;
