-- Display the buffer used when generating a proposal; revalidate current constraints on acceptance.
alter table t_grafiki add column czas_dojazdu_min integer check (czas_dojazdu_min >= 0);
