import{createClient}from'@supabase/supabase-js';
import{createIcons,icons}from'lucide';
import{authCredentials,calculateSummary,money,safeText}from'./data.js';
import'./styles.css';

const pages=[['Home','LayoutDashboard'],['Fatture','FileText'],['Email','Mail'],['Entrate','TrendingUp'],['Spese','TrendingDown'],['Banca','Landmark'],['Riepilogo','Rows3'],['Scadenze','CalendarClock'],['Statistiche','ChartNoAxesCombined'],['Backup','DatabaseBackup'],['Impostazioni','Settings']];
const envUrl=import.meta.env.VITE_SUPABASE_URL,envKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||import.meta.env.VITE_SUPABASE_ANON_KEY;
const cloudReady=Boolean(envUrl&&envKey&&!envUrl.includes('YOUR_PROJECT'));
const supabase=cloudReady?createClient(envUrl,envKey):null;
const state={page:'Home',session:null,transactions:[],invoices:[],categories:[],busy:false,error:''};
const app=document.querySelector('#app'),ico=n=>`<i data-lucide="${n}" aria-hidden="true"></i>`,draw=()=>createIcons({icons});
const date=v=>v?new Date(`${v}T00:00:00`).toLocaleDateString('it-IT'):'—';
const status=s=>({paid:'PAGATA',to_pay:'DA PAGARE',to_review:'DA CONTROLLARE'}[s]||s);

function setPage(page){state.page=page;state.error='';render()}
async function loadData(){
  if(!supabase||!state.session)return;
  state.busy=true;render();
  const[tx,inv,cat]=await Promise.all([
    supabase.from('transactions').select('*,categories(name)').order('occurred_on',{ascending:false}),
    supabase.from('invoices').select('*,categories(name)').order('due_on',{ascending:true}),
    supabase.from('categories').select('*').order('name')]);
  const failed=[tx,inv,cat].find(x=>x.error)?.error;
  if(failed)state.error=failed.message;else{state.transactions=tx.data;state.invoices=inv.data;state.categories=cat.data}
  state.busy=false;render();
}

function authView(){
  app.innerHTML=`<main class="auth-shell"><section class="auth-card"><div class="brand large"><span>${ico('WalletCards')}</span>SOLDI</div><p class="kicker">IL TUO SPAZIO FINANZIARIO</p><h1>Tutto sotto controllo.</h1><p class="auth-copy">Accedi per gestire entrate, spese, fatture e scadenze in uno spazio personale protetto.</p>${!cloudReady?'<div class="alert warning">Configurazione cloud non completata. Aggiungi le variabili Supabase al progetto Vercel.</div>':''}${state.error?`<div class="alert">${safeText(state.error)}</div>`:''}<form id="auth-form"><label>Email<input type="email" name="email" autocomplete="email" required></label><label>Password<input type="password" name="password" autocomplete="current-password" minlength="8" required></label><button class="primary wide" ${!cloudReady?'disabled':''}>Accedi</button><button class="secondary wide" type="button" id="signup" ${!cloudReady?'disabled':''}>Crea account</button></form><p class="legal">I dati sono separati per utente tramite policy di sicurezza del database.</p></section></main>`;
  draw();if(!cloudReady)return;
  const form=document.querySelector('#auth-form');
  form.onsubmit=e=>authenticate(e,false);
  document.querySelector('#signup').onclick=()=>{if(form.reportValidity())authenticate({preventDefault(){},currentTarget:form},true)};
}
async function authenticate(event,signup){
  event.preventDefault();state.error='';const form=event.currentTarget;
  if(!form.reportValidity())return;
  const credentials=authCredentials(Object.fromEntries(new FormData(form)));
  if(credentials.error){state.error=credentials.error;authView();return}
  const{email,password}=credentials;
  const result=signup?await supabase.auth.signUp({email,password,options:{emailRedirectTo:window.location.origin}}):await supabase.auth.signInWithPassword({email,password});
  if(result.error){state.error=result.error.message;authView()}else if(signup&&!result.data.session){state.error='Account creato. Controlla la tua email per confermare l’accesso.';authView()}
}

function shell(content){
  const user=state.session.user;
  app.innerHTML=`<div class="app-shell"><aside class="sidebar"><div class="brand"><span>${ico('WalletCards')}</span>SOLDI</div><nav>${pages.map(([label,glyph])=>`<button data-page="${label}" class="${state.page===label?'active':''}">${ico(glyph)}<span>${label}</span></button>`).join('')}</nav><div class="account"><div class="avatar">${safeText(user.email[0].toUpperCase())}</div><div><strong>${safeText(user.email.split('@')[0])}</strong><small>${safeText(user.email)}</small></div><button id="logout" title="Esci">${ico('LogOut')}</button></div></aside><main class="workspace"><header><button class="menu" id="menu">${ico('Menu')}</button><div><p class="kicker">GESTIONE FINANZIARIA</p><h1>${state.page}</h1></div><div class="cloud-state">${ico('Cloud')}<span>Cloud attivo</span></div></header>${state.error?`<div class="alert">${safeText(state.error)}</div>`:''}${state.busy?'<div class="loader">Sincronizzazione…</div>':''}<section>${content}</section></main><button class="scrim" id="scrim" aria-label="Chiudi menu"></button></div>`;
  document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>setPage(b.dataset.page));
  document.querySelector('#menu').onclick=()=>document.querySelector('.app-shell').classList.add('menu-open');
  document.querySelector('#scrim').onclick=()=>document.querySelector('.app-shell').classList.remove('menu-open');
  document.querySelector('#logout').onclick=()=>supabase.auth.signOut();draw();
}
function metric(label,value,glyph,tone=''){return`<article class="metric"><div class="metric-icon ${tone}">${ico(glyph)}</div><p>${label}</p><strong class="${tone}">${value}</strong><small>Aggiornato dal database</small></article>`}
function empty(message){return`<div class="empty">${ico('Inbox')}<p>${message}</p></div>`}
function txRows(rows){return rows.length?`<div class="rows">${rows.map(t=>`<div class="row"><div class="row-icon ${t.kind}">${ico(t.kind==='income'?'ArrowDownLeft':'ArrowUpRight')}</div><div><strong>${safeText(t.description)}</strong><small>${date(t.occurred_on)} · ${safeText(t.categories?.name||'Senza categoria')}</small></div><b class="${t.kind==='income'?'positive':'negative'}">${t.kind==='income'?'+':'−'}${money(t.amount)}</b></div>`).join('')}</div>`:empty('Nessun movimento registrato.')}
function invoiceRows(rows){return rows.length?`<div class="rows">${rows.map(i=>`<div class="row"><div><strong>${safeText(i.supplier)}</strong><small>${date(i.due_on)} · ${safeText(i.invoice_number||'Senza numero')}</small></div><div class="align-right"><b>${money(i.amount)}</b><span class="badge ${i.status}">${status(i.status)}</span></div></div>`).join('')}</div>`:empty('Nessuna scadenza aperta.')}
function bindJumps(){document.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>setPage(b.dataset.jump))}

function home(){
  const s=calculateSummary(state.transactions,state.invoices),due=state.invoices.filter(i=>i.status==='to_pay').slice(0,4);
  shell(`<div class="metric-grid">${metric('Saldo totale',money(s.balance),'Wallet')}${metric('Entrate mese',money(s.income),'ArrowUpRight','positive')}${metric('Spese mese',money(s.expenses),'ArrowDownRight','negative')}${metric('Da pagare',s.unpaid.length,'ReceiptText','warning')}</div><div class="content-grid"><article class="panel"><div class="panel-head"><div><p class="kicker">ATTIVITÀ</p><h2>Ultimi movimenti</h2></div><button data-jump="Riepilogo">Vedi tutti</button></div>${txRows(state.transactions.slice(0,6))}</article><article class="panel"><div class="panel-head"><div><p class="kicker">AGENDA</p><h2>Prossime scadenze</h2></div><button data-jump="Scadenze">Apri</button></div>${invoiceRows(due)}</article></div><div class="content-grid compact"><article class="panel spotlight"><div>${ico('PiggyBank')}<p>Risparmio del mese</p><strong class="${s.savings>=0?'positive':'negative'}">${money(s.savings)}</strong></div><div class="spark"><span style="width:${Math.min(100,s.income?Math.max(0,s.savings/s.income*100):0)}%"></span></div></article><article class="panel review"><div><p class="kicker">RICHIEDE ATTENZIONE</p><h2>${s.review.length} fatture da controllare</h2></div><button data-jump="Fatture" class="round">${ico('ArrowRight')}</button></article></div>`);bindJumps();draw();
}
function transactionPage(kind){
  const rows=state.transactions.filter(t=>t.kind===kind);
  shell(`<div class="toolbar"><p>${rows.length} operazioni sincronizzate</p><button class="primary" id="new-tx">${ico('Plus')} Nuova ${kind==='income'?'entrata':'spesa'}</button></div><article class="panel table-panel">${txRows(rows)}</article><dialog id="tx-dialog"><form id="tx-form" class="dialog-form"><div class="dialog-head"><div><p class="kicker">NUOVA OPERAZIONE</p><h2>Registra ${kind==='income'?'entrata':'spesa'}</h2></div><button type="button" class="icon-button" id="close-dialog">${ico('X')}</button></div><label>Descrizione<input name="description" required maxlength="140"></label><div class="form-grid"><label>Importo<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Data<input name="occurred_on" type="date" value="${new Date().toISOString().slice(0,10)}" required></label></div><label>Categoria<select name="category_id"><option value="">Senza categoria</option>${state.categories.filter(c=>c.kind===kind||c.kind==='both').map(c=>`<option value="${c.id}">${safeText(c.name)}</option>`).join('')}</select></label><label>Note<textarea name="notes" maxlength="500"></textarea></label><button class="primary wide">Salva nel cloud</button></form></dialog>`);
  const dialog=document.querySelector('#tx-dialog');document.querySelector('#new-tx').onclick=()=>dialog.showModal();document.querySelector('#close-dialog').onclick=()=>dialog.close();
  document.querySelector('#tx-form').onsubmit=async e=>{e.preventDefault();const v=Object.fromEntries(new FormData(e.target));Object.assign(v,{kind,user_id:state.session.user.id,amount:Number(v.amount),category_id:v.category_id||null});const{error}=await supabase.from('transactions').insert(v);if(error){state.error=error.message;render()}else{dialog.close();await loadData()}};draw();
}
function invoicesPage(){
  shell(`<div class="toolbar"><p>${state.invoices.length} fatture · classificazione prudente</p><button class="primary" id="new-invoice">${ico('Plus')} Nuova fattura</button></div><article class="panel table-panel">${invoiceRows(state.invoices)}</article><dialog id="invoice-dialog"><form id="invoice-form" class="dialog-form"><div class="dialog-head"><div><p class="kicker">NUOVO DOCUMENTO</p><h2>Registra fattura</h2></div><button type="button" class="icon-button" id="close-dialog">${ico('X')}</button></div><div class="form-grid"><label>Fornitore<input name="supplier" required maxlength="160"></label><label>Importo<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Numero fattura<input name="invoice_number" maxlength="80"></label><label>IUV<input name="iuv" maxlength="80"></label><label>Data documento<input name="issued_on" type="date"></label><label>Scadenza<input name="due_on" type="date"></label></div><label>Stato<select name="status"><option value="to_review">DA CONTROLLARE</option><option value="to_pay">DA PAGARE</option><option value="paid">PAGATA</option></select></label><p class="form-note">“Pagata” va selezionato solo con una prova verificata.</p><button class="primary wide">Salva nel cloud</button></form></dialog>`);
  const dialog=document.querySelector('#invoice-dialog');document.querySelector('#new-invoice').onclick=()=>dialog.showModal();document.querySelector('#close-dialog').onclick=()=>dialog.close();
  document.querySelector('#invoice-form').onsubmit=async e=>{e.preventDefault();const v=Object.fromEntries(new FormData(e.target));Object.assign(v,{user_id:state.session.user.id,amount:Number(v.amount)});for(const k of['invoice_number','iuv','issued_on','due_on'])if(!v[k])v[k]=null;const{error}=await supabase.from('invoices').insert(v);if(error){state.error=error.message;render()}else{dialog.close();await loadData()}};draw();
}
function summaryPage(){shell(`<article class="panel"><div class="panel-head"><div><p class="kicker">REGISTRO UNICO</p><h2>Tutte le operazioni</h2></div><span>${state.transactions.length} elementi</span></div>${txRows(state.transactions)}</article>`);draw()}
function deadlinesPage(){shell(`<article class="panel"><div class="panel-head"><div><p class="kicker">SCADENZE</p><h2>Fatture ancora aperte</h2></div></div>${invoiceRows(state.invoices.filter(i=>i.status==='to_pay'))}</article>`);draw()}
function statsPage(){const s=calculateSummary(state.transactions,state.invoices),max=Math.max(s.income,s.expenses,1);shell(`<div class="metric-grid three">${metric('Entrate mese',money(s.income),'TrendingUp','positive')}${metric('Spese mese',money(s.expenses),'TrendingDown','negative')}${metric('Risparmio',money(s.savings),'PiggyBank',s.savings>=0?'positive':'negative')}</div><article class="panel chart"><h2>Andamento del mese</h2><div><span>Entrate</span><div class="bar"><i style="width:${s.income/max*100}%"></i></div><b>${money(s.income)}</b></div><div><span>Spese</span><div class="bar"><i class="expense" style="width:${s.expenses/max*100}%"></i></div><b>${money(s.expenses)}</b></div></article>`);draw()}
function placeholder(title,copy,glyph){shell(`<article class="panel placeholder"><div class="placeholder-icon">${ico(glyph)}</div><p class="kicker">MODULO PREPARATO</p><h2>${title}</h2><p>${copy}</p></article>`);draw()}
function render(){if(!state.session)return authView();const routes={Home:home,Fatture:invoicesPage,Entrate:()=>transactionPage('income'),Spese:()=>transactionPage('expense'),Riepilogo:summaryPage,Scadenze:deadlinesPage,Statistiche:statsPage,Email:()=>placeholder('Email','Il connettore Gmail multi-account sarà attivato con OAuth e sincronizzazione idempotente.','Mail'),Banca:()=>placeholder('Banca','La struttura dati è pronta per conti, movimenti e riconciliazione senza doppio conteggio.','Landmark'),Backup:()=>placeholder('Backup','Backup automatici, ripristino e storico saranno gestiti lato server.','DatabaseBackup'),Impostazioni:()=>placeholder('Impostazioni','Profilo, categorie, collegamenti e preferenze personali.','Settings')};(routes[state.page]||home)()}

if(supabase){supabase.auth.getSession().then(({data})=>{state.session=data.session;if(state.session)loadData();else render()});supabase.auth.onAuthStateChange((event,session)=>{state.session=session;if(event==='SIGNED_IN')setTimeout(loadData,0);else render()})}else render();
