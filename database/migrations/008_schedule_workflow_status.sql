update t_grafiki set status = case
  when rejected_at is not null then 'rejected'
  when approved_at is not null then 'accepted'
  else 'proposed'
end;

comment on column t_grafiki.status is 'Schedule lifecycle status: proposed, accepted, rejected or superseded. solution_status stores feasibility separately.';
