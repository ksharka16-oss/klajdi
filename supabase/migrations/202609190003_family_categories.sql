insert into public.categories(user_id,name,kind,color)
select users.id, defaults.name, defaults.kind, defaults.color
from auth.users as users
cross join (values
  ('Bollette','expense','#62b7ff'),
  ('Scuola e asilo','expense','#f5bf57'),
  ('Abbonamenti','expense','#b782ff')
) as defaults(name,kind,color)
on conflict(user_id,name,kind) do nothing;

with inferred as (
  select transactions.id,
    case
      when transactions.kind='income' and transactions.description ~* '(stipendio|salary|emolument|competenze)' then 'Stipendio'
      when transactions.kind='income' and transactions.description ~* '(rimborso|storno|cashback)' then 'Rimborsi'
      when transactions.kind='expense' and transactions.description ~* '(asilo|nido|mensa|scuola|scolastic|retta)' then 'Scuola e asilo'
      when transactions.kind='expense' and transactions.description ~* '(enel|plenitude|a2a|hera|energia|luce|gas|acqua|bolletta|tim|vodafone|windtre|fastweb)' then 'Bollette'
      when transactions.kind='expense' and transactions.description ~* '(netflix|spotify|disney|amazon prime|apple.com/bill|google play|abbonamento)' then 'Abbonamenti'
      when transactions.kind='expense' and transactions.description ~* '(esselunga|conad|coop|lidl|eurospin|carrefour|aldi|supermercat|alimentari)' then 'Alimentari'
      when transactions.kind='expense' and transactions.description ~* '(carburante|benzina|diesel|q8|tamoil|telepass|autostrad|trenitalia|trasport|atm milano|eni station)' then 'Trasporti'
      when transactions.kind='expense' and transactions.description ~* '(farmacia|parafarmacia|medic|dentist|ospedal|sanitari)' then 'Salute'
      when transactions.kind='expense' and transactions.description ~* '(affitto|condominio|mutuo|ikea|leroy merlin|casa)' then 'Casa'
    end as category_name
  from public.transactions
  where transactions.source='bank' and transactions.category_id is null
), targets as (
  select inferred.id, categories.id as category_id
  from inferred
  join public.transactions on transactions.id=inferred.id
  join public.categories on categories.user_id=transactions.user_id and categories.name=inferred.category_name and categories.kind=transactions.kind::text
  where inferred.category_name is not null
)
update public.transactions
set category_id=targets.category_id, updated_at=now()
from targets
where transactions.id=targets.id and transactions.category_id is null;
