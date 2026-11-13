alter table t_ai_wiadomosci add column if not exists message_order bigint;

with numbered as (
  select id_wiadomosci, row_number() over (partition by id_rozmowy order by created_at, id_wiadomosci) as ordinal
  from t_ai_wiadomosci where message_order is null
)
update t_ai_wiadomosci m set message_order = numbered.ordinal
from numbered where m.id_wiadomosci = numbered.id_wiadomosci;

alter table t_ai_wiadomosci alter column message_order set not null;
create unique index if not exists uq_t_ai_wiadomosci_conversation_order
  on t_ai_wiadomosci(id_rozmowy, message_order);
