// Budget familiare: pianificazione separata dai movimenti bancari reali.
const defaults={monthly_income:2000,fixed_amount:800,reserve_amount:250,personal_amount:300,family_amount:650,ticket_value:10.33,ticket_days:22};
const names={payment:'Retta pagata dal conto 3',refund:'Rimborso INPS sul conto 1',reserve_transfer:'Rimborso spostato al conto 2'};
const icons={payment:'CreditCard',refund:'Landmark',reserve_transfer:'PiggyBank'};
let cache={userId:null,loaded:false,loading:false,settings:{...defaults},events:[],saving:false};
const number=v=>Number(v||0);
const escapeText=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const icon=name=>'<i data-lucide="'+name+'" aria-hidden="true"></i>';
const row=(label,amount,sub,accent,iconName)=>'<article class="family-account '+accent+'"><span class="family-account-icon">'+icon(iconName)+'</span><div><strong>'+label+'</strong><small>'+sub+'</small></div><b>'+amount+'</b></article>';
async function load(ctx){
 if(cache.loading||cache.loaded)return;
 cache.loading=true;
 const [settings,events]=await Promise.all([
  ctx.supabase.from('family_budget_settings').select('*').eq('user_id',ctx.userId).maybeSingle(),
  ctx.supabase.from('nursery_budget_events').select('*').eq('user_id',ctx.userId).order('occurred_on',{ascending:false}).order('created_at',{ascending:false}).limit(100)
 ]);
 if(cache.userId!==ctx.userId)return;
 cache.loading=false;cache.loaded=true;
 if(settings.error||events.error){cache.error=settings.error?.message||events.error?.message;return ctx.refresh()}
 cache.settings={...defaults,...(settings.data||{})};cache.events=events.data||[];cache.error='';ctx.refresh();
}
export function familyBudgetPage(ctx){
 if(cache.userId!==ctx.userId)cache={userId:ctx.userId,loaded:false,loading:false,settings:{...defaults},events:[],saving:false};
 const s=cache.settings,total=number(s.fixed_amount)+number(s.reserve_amount)+number(s.personal_amount)+number(s.family_amount),left=number(s.monthly_income)-total;
 const tickets=number(s.ticket_days)*number(s.ticket_value);
 const paid=cache.events.filter(x=>x.kind==='payment').reduce((a,x)=>a+number(x.amount),0);
 const refunded=cache.events.filter(x=>x.kind==='refund').reduce((a,x)=>a+number(x.amount),0);
 const moved=cache.events.filter(x=>x.kind==='reserve_transfer').reduce((a,x)=>a+number(x.amount),0);
 const euro=ctx.money;
 const controls=[['monthly_income','Stipendio netto'],['fixed_amount','Conto 1 · Spese fisse'],['reserve_amount','Conto 2 · Risparmio e auto'],['personal_amount','Conto 3 · Personale'],['family_amount','Conto 4 · Famiglia'],['ticket_value','Ticket per giorno'],['ticket_days','Giorni con ticket']];
 const content='<div class="family-budget">'+
 '<section class="family-hero"><div><p class="kicker">PIANIFICAZIONE MENSILE</p><h2>Il budget della famiglia</h2><p>Quattro conti, una divisione chiara. Le cifre sono budget previsti, non saldi bancari.</p></div><div class="family-hero-total"><span>Stipendio previsto</span><strong>'+euro(s.monthly_income)+'</strong><small>+ '+euro(tickets)+' di ticket pasto</small></div></section>'+
 (cache.error?'<div class="alert">'+escapeText(cache.error)+'</div>':'')+
 '<section class="family-accounts">'+
 row('Conto 1',euro(s.fixed_amount),'Stipendio, affitto, bollette e debito','blue','Landmark')+
 row('Conto 2',euro(s.reserve_amount),'Auto, emergenze, casa e rimborsi','green','PiggyBank')+
 row('Conto 3',euro(s.personal_amount),'Personale; asilo pagato a parte','purple','Coffee')+
 row('Conto 4',euro(s.family_amount),'Spesa, mensa, vestiti e bambini','orange','ShoppingCart')+
 '</section>'+
 '<section class="panel family-panel"><div class="panel-head"><div><p class="kicker">BUDGET</p><h2>Modifica la divisione</h2></div></div>'+
 '<form id="family-budget-form" class="family-form">'+controls.map(x=>'<label>'+x[1]+'<input type="number" inputmode="decimal" min="0" '+(x[0]==='ticket_days'?'max="31" step="1"':'step="0.01"')+' name="'+x[0]+'" value="'+escapeText(s[x[0]])+'" required></label>').join('')+
 '<div class="family-budget-result '+(left<0?'family-over':'')+'"><span>'+(left>=0?'Ancora da distribuire':'Budget oltre lo stipendio')+'</span><strong>'+euro(Math.abs(left))+'</strong></div>'+
 '<p class="family-note">I ticket non sono denaro sul conto: puoi usarli per ridurre gli acquisti alimentari dove vengono accettati. I '+euro(s.personal_amount)+' personali non comprendono la retta variabile dell’asilo.</p>'+
 '<button class="primary" type="submit" '+(cache.saving?'disabled':'')+'>'+icon('Save')+' Salva budget</button></form></section>'+
 '<section class="panel family-panel"><div class="panel-head"><div><p class="kicker">ASILO NIDO</p><h2>Retta e rimborso manuali</h2></div></div>'+
 '<div class="family-flow"><div>'+icon('CreditCard')+'<strong>Conto 3</strong><small>Paghi la retta</small></div><span>→</span><div>'+icon('Landmark')+'<strong>Conto 1</strong><small>Arriva il rimborso</small></div><span>→</span><div>'+icon('PiggyBank')+'<strong>Conto 2</strong><small>Metti da parte</small></div></div>'+
 '<p class="family-note">Registra soltanto i passaggi che sono davvero avvenuti. Questi promemoria non fanno bonifici e non aggiungono nuove entrate o spese ai movimenti bancari.</p>'+
 '<form id="family-event-form" class="family-form family-event-form"><label>Operazione<select name="kind"><option value="payment">Retta pagata dal conto 3</option><option value="refund">Rimborso INPS ricevuto sul conto 1</option><option value="reserve_transfer">Trasferimento al conto 2</option></select></label><label>Importo (€)<input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required></label><label>Data<input name="occurred_on" type="date" value="'+ctx.today()+'" required></label><label>Nota facoltativa<input name="note" maxlength="300" placeholder="Es. retta settembre"></label><button type="submit" class="primary" '+(cache.saving?'disabled':'')+'>'+icon('Plus')+' Registra passaggio</button></form>'+
 '<div class="family-totals"><div><small>Rette registrate</small><strong>'+euro(paid)+'</strong></div><div><small>Rimborsi ricevuti</small><strong>'+euro(refunded)+'</strong></div><div><small>Trasferiti al conto 2</small><strong>'+euro(moved)+'</strong></div></div>'+
 '<p class="family-note">Rette meno rimborsi registrati: '+euro(paid-refunded)+'. È un saldo dei promemoria, non un saldo bancario né il costo definitivo dell’asilo. Per anticipare le rette serve liquidità aggiuntiva sul conto 3.</p>'+
 '<h3>Storico manuale</h3><div class="family-events">'+(cache.events.length?cache.events.map(x=>'<div class="family-event"><span class="family-event-icon">'+icon(icons[x.kind]||'Receipt')+'</span><div><strong>'+escapeText(names[x.kind]||x.kind)+'</strong><small>'+escapeText(x.occurred_on)+' '+escapeText(x.note||'')+'</small></div><b>'+euro(x.amount)+'</b><button type="button" data-delete-family="'+escapeText(x.id)+'" aria-label="Elimina promemoria">'+icon('Trash2')+'</button></div>').join(''):'<p class="family-note">Nessun passaggio registrato.</p>')+'</div></section>'+
 '<p class="family-footnote">Questa sezione è separata dalle sincronizzazioni bancarie e dal riepilogo delle entrate/spese. Nessun movimento esistente viene modificato.</p></div>';
 ctx.shell(content);ctx.draw();
 if(!cache.loaded&&!cache.loading)load(ctx);
 const budget=document.querySelector('#family-budget-form');
 if(budget)budget.onsubmit=async e=>{
  e.preventDefault();if(cache.saving)return;
  const form=new FormData(budget),values={user_id:ctx.userId};
  for(const [key] of controls)values[key]=number(form.get(key));
  if(values.ticket_days>31||!Number.isInteger(values.ticket_days)||Object.values(values).some(v=>typeof v==='number'&&!Number.isFinite(v))){cache.error='Controlla i valori inseriti.';return ctx.refresh()}
  cache.saving=true;
  const {error}=await ctx.supabase.from('family_budget_settings').upsert({...values,updated_at:new Date().toISOString()},{onConflict:'user_id'});
  cache.saving=false;
  if(error)cache.error=error.message;else{cache.error='';cache.settings={...cache.settings,...values}}
  ctx.refresh();
 };
 const eventForm=document.querySelector('#family-event-form');
 if(eventForm)eventForm.onsubmit=async e=>{
  e.preventDefault();if(cache.saving)return;
  const f=new FormData(eventForm),amount=number(f.get('amount')),kind=String(f.get('kind')),occurred_on=String(f.get('occurred_on')),note=String(f.get('note')||'').trim();
  if(amount<=0||!names[kind]||!/^\d{4}-\d{2}-\d{2}$/.test(occurred_on)){cache.error='Controlla importo, tipo e data.';return ctx.refresh()}
  if(!confirm('Confermi che questo passaggio è già avvenuto?'))return;
  cache.saving=true;
  const {error}=await ctx.supabase.from('nursery_budget_events').insert({user_id:ctx.userId,kind,amount,occurred_on,note});
  cache.saving=false;
  if(error)cache.error=error.message;else{cache.error='';cache.loaded=false;cache.events=[]}
  ctx.refresh();
 };
 document.querySelectorAll('[data-delete-family]').forEach(button=>button.onclick=async()=>{
  if(!confirm('Eliminare questo promemoria? Non verranno toccati i movimenti bancari.'))return;
  const {error}=await ctx.supabase.from('nursery_budget_events').delete().eq('id',button.dataset.deleteFamily).eq('user_id',ctx.userId);
  if(error)cache.error=error.message;else{cache.loaded=false;cache.events=[];cache.error=''}
  ctx.refresh();
 });
}
