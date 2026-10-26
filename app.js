(function(){
'use strict';
var CFG=window.SEP_CONFIG;
var sb=window.supabase.createClient(CFG.SUPABASE_URL,CFG.SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
var $=function(id){return document.getElementById(id)};
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function fmt(n){return Number(n||0).toLocaleString('pt-BR')}
var LSK='sep-web';
function lsGet(k,d){try{var v=localStorage.getItem(LSK+'-'+k);return v==null?d:v}catch(e){return d}}
function lsSet(k,v){try{localStorage.setItem(LSK+'-'+k,v)}catch(e){}}

/* ---------- plano (vem do Supabase) ---------- */
var BOX={},BOXES=[],NOTAS={},BYISBN={},PED={},TIT={},SOBRA={},ALIAS={},TOT={C:0,E:0,D:0},NEED={CBP:0,CBTBE:0,DEV:0,URG:0};
var BK=['C','K','E','D'],EVS=['CBP','CBTBE'];
var DEST={C:'CBP',K:'CBP',E:'CBTBE',D:'DEVOLUÇÃO POA',X:'DEVOLUÇÃO POA',U:'URGÊNCIA DEV'},DCLS={C:'cbp',K:'cbp',E:'cbtbe',D:'dev',X:'dev',U:'urg'};
function plan(r){return {C:r[4]-r[7],K:r[7],E:r[5],D:r[6]}}
function isbn10to13(d){var b='978'+d.slice(0,9),s=0;for(var i=0;i<12;i++)s+=(+b[i])*(i%2?3:1);return b+((10-s%10)%10)}
function need(i,ev){return Math.max(0,((PED[i]||{})[ev]||0)-(ev==='URG'?0:((SOBRA[i]||{})[ev]||0)))}
function tituloDe(i){return TIT[i]||((BYISBN[i]||[])[0]?BYISBN[i][0].r[1]:i)}

var PLANO_INFO=null;
async function carregarPlanoDoBanco(){
  var d=await rpc('sep_plano',{});
  PLANO_INFO=d.info||null;
  var cx=d.caixas.map(function(c){return {id:c[0],situacao:c[1],convertida:c[2],notas:c[3]}});
  var it=d.itens.map(function(x){return {caixa:x[0],isbn:x[1],descricao:x[2],nota:x[3],estoque:x[4],cbp:x[5],comp:x[6],cbtbe:x[7],dev:x[8]}});
  var pd=d.pedidos.map(function(p){return {isbn:p[0],evento:p[1],titulo:p[2],qtd:p[3]}});
  BOX={};BOXES=[];NOTAS={};BYISBN={};PED={};TIT={};SOBRA={};ALIAS={};TOT={C:0,E:0,D:0};NEED={CBP:0,CBTBE:0,DEV:0,URG:0};
  cx.forEach(function(c){var b={id:c.id,sit:c.situacao,conv:c.convertida,notas:c.notas||[],it:[],units:0};BOX[c.id]=b;BOXES.push(b);b.notas.forEach(function(n){(NOTAS[n]=NOTAS[n]||[]).push(c.id)})});
  BOXES.sort(function(a,b){return (a.id==='S/Caixa')-(b.id==='S/Caixa')||a.id.localeCompare(b.id)});
  it.forEach(function(x){var b=BOX[x.caixa];if(!b)return;var r=[x.isbn,x.descricao,x.nota,x.estoque,x.cbp,x.cbtbe,x.dev,x.comp];b.it.push(r);b.units+=x.estoque;
    (BYISBN[x.isbn]=BYISBN[x.isbn]||[]).push({box:x.caixa,r:r});TOT.C+=x.cbp;TOT.E+=x.cbtbe;TOT.D+=x.dev});
  pd.forEach(function(p){(PED[p.isbn]=PED[p.isbn]||{})[p.evento]=p.qtd;TIT[p.isbn]=p.titulo});
  Object.keys(PED).forEach(function(i){var c=0,e=0,d=0;(BYISBN[i]||[]).forEach(function(x){c+=x.r[4]-x.r[7];e+=x.r[5];d+=x.r[6]});SOBRA[i]={CBP:c,CBTBE:e,DEV:d};if(i.length===10)ALIAS[isbn10to13(i)]=i});
  Object.keys(PED).forEach(function(i){['CBP','CBTBE','DEV','URG'].forEach(function(ev){NEED[ev]+=need(i,ev)})});
  return cx.length;
}

/* ---------- leituras ---------- */
var LID={},HIST=[];   // LID['tipo|caixa|isbn'] = {C,K,E,D,X}
function lidKey(t,c,i){return t+'|'+(c||'')+'|'+i}
function addLid(t,c,i,d,q){var k=lidKey(t,c,i),v=LID[k]||(LID[k]={C:0,K:0,E:0,D:0,X:0,U:0});v[d]=(v[d]||0)+q}
function boxItemRead(c,i){var a=LID[lidKey('caixa',c,i)],b=LID[lidKey('item',c,i)],o={C:0,K:0,E:0,D:0,X:0};[a,b].forEach(function(v){if(v)for(var k in o)o[k]+=v[k]});return o}
function boxRead(c){var b=BOX[c],t=0;if(!b)return 0;b.it.forEach(function(r){var x=boxItemRead(c,r[0]);t+=x.C+x.K+x.E+x.D});return t}
// caixa física = número da caixa + nota fiscal
function itensFis(c,n){var b=BOX[c];return b?b.it.filter(function(r){return r[2]===n}):[]}
function unidFis(c,n){return itensFis(c,n).reduce(function(a,r){return a+r[3]},0)}
function lidoFis(c,n){return itensFis(c,n).reduce(function(a,r){var x=boxItemRead(c,r[0]);return a+x.C+x.K+x.E+x.D},0)}
function sitFis(c,n){if(c==='S/Caixa')return 'Avulso';var it=itensFis(c,n),t=0,C=0,E=0,D=0;it.forEach(function(r){t+=r[3];C+=r[4];E+=r[5];D+=r[6]});
  if(!t)return null;return C===t?'Inteira CBP':E===t?'Inteira CBTBE':D===t?'Devolução fechada':'Aberta'}
function solto(i){return LID[lidKey('solto','',i)]||{C:0,K:0,E:0,D:0,X:0,U:0}}
function SK(ev){return ev==='CBP'?'C':ev==='CBTBE'?'E':ev==='URG'?'U':'D'}
function falta(i,ev){return Math.max(0,need(i,ev)-(solto(i)[SK(ev)]||0))}
var versaoBanco=null;
async function carregarEstado(){
  var d=await rpc('sep_estado',{});
  LID={};d.lidos.forEach(function(r){addLid(r[0],r[1],r[2],r[3],r[4])});
  HIST=d.hist.map(function(h){var m={};(h.dest||[]).forEach(function(k){m[k]=1});h.dest=m;return h});
  if(versaoBanco!==null&&d.versao!==versaoBanco){versaoBanco=d.versao;await carregarPlanoDoBanco();verificarPlano()}
  versaoBanco=d.versao;
}
async function carregarLidos(){return carregarEstado()}
async function carregarHist(){}
var refreshT=null;
function agendarRefresh(ms){clearTimeout(refreshT);refreshT=setTimeout(async function(){try{await carregarEstado();setSync('ok','SINCRONIZADO');render()}catch(e){if(!sessaoCaiu(e))setSync('err','SEM CONEXÃO')}},ms||600)}

/* ---------- interface ---------- */
var cur=null,curNota=null,sel=null,armed=null,armT=null,nome=lsGet('nome','');
function setSync(c,t){var el=$('sync');el.className='sync '+c;el.textContent=t}
var actx=null;
function audioAtivar(){try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();if(actx.state==='suspended')actx.resume();
  var o=actx.createOscillator(),g=actx.createGain();g.gain.value=0.0001;o.connect(g);g.connect(actx.destination);o.start();o.stop(actx.currentTime+0.02)}catch(e){}}
['pointerdown','touchstart','keydown'].forEach(function(ev){document.addEventListener(ev,function una(){audioAtivar();document.removeEventListener(ev,una,true)},true)});
function beep(f,d,n){try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();if(actx.state==='suspended')actx.resume();for(var i=0;i<(n||1);i++){var o=actx.createOscillator(),g=actx.createGain();o.frequency.value=f;o.connect(g);g.connect(actx.destination);var t=actx.currentTime+i*(d+.06);g.gain.setValueAtTime(.18,t);g.gain.exponentialRampToValueAtTime(.001,t+d);o.start(t);o.stop(t+d)}}catch(e){}}
var TONE={U:[740,.1,3],C:[880,.12,1],K:[660,.12,2],E:[1180,.12,1],D:[330,.2,1],X:[330,.2,2],ERR:[200,.45,2],BOX:[990,.1,3]};
function tone(k){beep.apply(null,TONE[k])}
function flash(cls,dest,t,c,extra){var html='<div class="dest">'+esc(dest)+'</div>'+(t?'<div class="t">'+esc(t)+'</div>':'')+(c?'<div class="c">'+c+'</div>':'')+(extra||'');
  var f=$('flash');f.className='flash f-'+cls;f.innerHTML=html;
  if(camAberta){var r=$('camRes');r.className='cam-res f-'+cls;r.innerHTML=html}}
var TOQUE=window.matchMedia&&window.matchMedia('(pointer:coarse)').matches;
function focusTit(){if(camAberta||TOQUE)return;$('inTit').focus()}

function counts(){
  var r={sC:0,sE:0,sD:0,lC:0,lE:0,lD:0,U:0};
  for(var k in LID){var v=LID[k],t=k.split('|')[0];if(t==='solto'){r.lC+=v.C;r.lE+=v.E;r.lD+=v.D;r.U+=v.U||0}else{r.sC+=v.C+v.K;r.sE+=v.E;r.sD+=v.D+v.X}}
  r.C=r.sC+r.lC;r.E=r.sE+r.lE;r.D=r.sD+r.lD;return r}
function renderCounters(){
  var c=counts(),EVK={cbp:'CBP',cbtbe:'CBTBE',urg:'URG',dev:'DEV'};
  var defs=[['CBP','cbp',c.C,TOT.C+NEED.CBP,'Sobra '+fmt(c.sC)+'/'+fmt(TOT.C)+' · soltos '+fmt(c.lC)+'/'+fmt(NEED.CBP)],
            ['CBTBE','cbtbe',c.E,TOT.E+NEED.CBTBE,'Sobra '+fmt(c.sE)+'/'+fmt(TOT.E)+' · soltos '+fmt(c.lE)+'/'+fmt(NEED.CBTBE)],
            ['URGÊNCIA DEV','urg',c.U,NEED.URG,'Livros soltos · '+fmt(c.U)+'/'+fmt(NEED.URG)],
            ['DEVOLUÇÃO POA','dev',c.D,TOT.D+NEED.DEV,'Sobra '+fmt(c.sD)+'/'+fmt(TOT.D)+' · soltos '+fmt(c.lD)+'/'+fmt(NEED.DEV)]];
  $('counters').innerHTML=defs.map(function(d){var f=Math.max(0,d[3]-d[2]),ev=EVK[d[1]];
    return '<div class="ctr c-'+d[1]+(sel===ev?' sel':'')+'" role="button" tabindex="0" data-ev="'+ev+'"><div class="l">'+d[0]+'</div><div class="v">'+fmt(d[2])+' <small>/ '+fmt(d[3])+'</small></div><div class="s">'+(f?'Faltam '+fmt(f)+' un':'Completo')+' · '+d[4]+'</div><div class="bar"><i style="width:'+(d[3]?Math.min(100,100*d[2]/d[3]):0).toFixed(1)+'%"></i></div><div class="tap">'+(sel===ev?'▲ Lista aberta abaixo':'▼ Toque para ver os títulos')+'</div></div>'}).join('');
}
function destLabel(h){var ks=Object.keys(h.dest);if(ks.length>1&&ks.every(function(k){return k==='C'||k==='K'}))return ['CBP','cbp'];
  if(ks.length>1)return ['VÁRIOS','abrir'];var k=ks[0];return [DEST[k]+(k==='K'?' compl.':k==='X'?' exced.':''),DCLS[k]]}
var HISTB=null,histT=null;
function renderHist(){
  var lista=HISTB||HIST;
  $('histTitulo').textContent=HISTB?'Resultado da busca':'Últimas leituras da equipe';
  $('histInfo').textContent=HISTB?(HISTB.length?HISTB.length+' leitura(s) encontrada(s)'+(HISTB.length>=150?' (mostrando as 150 mais recentes)':'')+'. Apague a busca para voltar às últimas leituras.':'Nenhuma leitura encontrada.'):'';
  var mine=HIST.filter(function(h){return !h.rev&&h.quem===nome});
  $('btnUndo').disabled=!mine.length;
  $('hist').innerHTML=lista.map(function(h){var t=new Date(h.ts),dl=destLabel(h);
    return '<tr class="'+(h.rev?'rev':'')+'"><td class="mono">'+(HISTB?t.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})+' ':'')+t.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})+'</td><td>'+esc(h.rotulo)+'</td><td><span class="pill p-'+dl[1]+'">'+esc(dl[0])+'</span></td><td class="n">'+h.q+'</td><td class="muted">'+esc(h.quem||'')+'</td><td>'+(h.rev?'<span class="muted" style="font-size:11px">revertido</span>':'<button class="btn sm'+(armed===h.grupo?' warn':'')+'" data-rev="'+h.grupo+'">'+(armed===h.grupo?'Confirmar?':'Reverter')+'</button>')+'</td></tr>'}).join('')||'<tr><td colspan="6" class="muted">Nenhuma leitura ainda.</td></tr>';
}
function renderBox(){
  var ctx=$('ctx'),bt=$('boxTitle'),bb=$('boxBody');
  if(!cur){ctx.innerHTML='';bt.textContent='Caixa ativa';bb.className='muted';bb.style.fontSize='13px';bb.innerHTML='Nenhuma caixa aberta ativa. Caixas fechadas são registradas de uma vez ao serem lidas; títulos bipados sem caixa ativa são livros soltos.';return}
  var b=BOX[cur],t=lidoFis(cur,curNota),un=unidFis(cur,curNota);
  ctx.innerHTML='<div class="ctx"><span>Caixa ativa: <b class="mono">'+esc(cur)+'</b> · NF <b class="mono">'+curNota+'</b> · conferidas <b>'+fmt(t)+'/'+fmt(un)+'</b></span><button class="btn sm" id="btnFecharCx">Fechar caixa ativa</button></div>';
  $('btnFecharCx').onclick=function(){cur=null;curNota=null;flash('dev','CAIXA FECHADA','','Próximos títulos bipados serão tratados como livros soltos.');render();focusTit()};
  bt.textContent='Caixa '+cur+' · NF '+curNota+' · '+sitFis(cur,curNota);bb.className='';bb.style.fontSize='';
  var h='<div class="tbl-wrap"><table><thead><tr><th>Título</th><th>Previsto</th><th class="n">Lido</th></tr></thead><tbody>';
  itensFis(cur,curNota).forEach(function(r){var pl=plan(r),x=boxItemRead(cur,r[0]),ds=[],n=x.C+x.K+x.E+x.D;
    if(pl.C)ds.push('<span class="pill p-cbp">CBP '+x.C+'/'+pl.C+'</span>');if(pl.K)ds.push('<span class="pill p-comp">CBP compl. '+x.K+'/'+pl.K+'</span>');
    if(pl.E)ds.push('<span class="pill p-cbtbe">CBTBE '+x.E+'/'+pl.E+'</span>');if(pl.D)ds.push('<span class="pill p-dev">DEV '+x.D+'/'+pl.D+'</span>');if(x.X)ds.push('<span class="pill p-err">+'+x.X+' exced.</span>');
    h+='<tr class="'+(n>=r[3]?'done':'')+'"><td>'+esc(r[1])+'<div class="mono muted" style="font-size:11px">'+r[0]+'</div></td><td>'+ds.join(' ')+'</td><td class="n">'+n+'/'+r[3]+'</td></tr>'});
  bb.innerHTML=h+'</tbody></table></div>';
}
function pendRows(ev){
  var map={},key=ev==='CBP'?['C','K']:ev==='CBTBE'?['E']:ev==='URG'?[]:['D','X'];
  function add(i,o,p,l){var m=map[i]||(map[i]={i:i,prev:0,lido:0,o:{}});m.prev+=p;m.lido+=l;m.o[o]=1}
  BOXES.forEach(function(b){b.it.forEach(function(r){var pl=plan(r),x=boxItemRead(b.id,r[0]),p=0,l=0;key.forEach(function(k){p+=pl[k]||0;l+=x[k]||0});if(p||l)add(r[0],(function(s){return s==='Aberta'||s==='Avulso'})(sitFis(b.id,r[2]))?'separação':'caixa fechada',p,l)})});
  var sk=SK(ev);
  Object.keys(PED).forEach(function(i){var n=need(i,ev),g=solto(i)[sk]||0;if(n||g)add(i,'soltos',n,g)});
  Object.keys(LID).forEach(function(k){var p=k.split('|');if(p[0]==='solto'&&!PED[p[2]]&&LID[k][sk])add(p[2],'soltos fora do plano',0,LID[k][sk])});
  return Object.keys(map).map(function(k){return map[k]});
}
function ondeAchar(i,ev){
  var out=[],key=ev==='CBP'?['C','K']:ev==='CBTBE'?['E']:ev==='URG'?[]:['D'];
  (BYISBN[i]||[]).forEach(function(x){var b=BOX[x.box],s=boxItemRead(x.box,i),pl=plan(x.r),f=0;key.forEach(function(k){f+=Math.max(0,(pl[k]||0)-(s[k]||0))});
    var sf=sitFis(x.box,x.r[2]);if(f)out.push('<span class="pill p-'+(sf==='Aberta'||sf==='Avulso'?'abrir':'dev')+'">'+(x.box==='S/Caixa'?'Avulsos':'Cx '+esc(x.box))+' · NF '+x.r[2]+' · '+f+'</span>')});
  if(falta(i,ev))out.push('<span class="pill" style="background:var(--bg-card-2);color:var(--text)">Estoque (solto) · '+falta(i,ev)+'</span>');
  return out.join(' ');
}
function renderPend(){
  var box=$('lista');if(!sel){box.classList.add('hidden');return}box.classList.remove('hidden');
  var ev=sel,st=$('pSt').value,q=$('pQ').value.trim().toUpperCase(),all=pendRows(ev),tp=0,tl=0,nf=0;
  all.forEach(function(r){tp+=r.prev;tl+=Math.min(r.lido,r.prev);if(r.prev>r.lido)nf++});
  $('lstTitle').textContent='Títulos do pedido '+(ev==='DEV'?'Devolução POA':ev==='URG'?'Urgência de devolução':ev);
  $('lstSum').textContent=all.length+' títulos · '+nf+' com unidades faltando · lido '+fmt(tl)+' de '+fmt(tp)+' previstas';
  var rows=all.filter(function(r){var f=r.prev>r.lido;return (st==='all'||(st==='falta'&&f)||(st==='ok'&&!f))&&(!q||r.i.indexOf(q)>=0||tituloDe(r.i).toUpperCase().indexOf(q)>=0)});
  rows.sort(function(a,b){return (b.prev-b.lido)-(a.prev-a.lido)||tituloDe(a.i).localeCompare(tituloDe(b.i))});
  $('pend').innerHTML=rows.slice(0,600).map(function(r){var f=Math.max(0,r.prev-r.lido);return '<tr class="'+(f?'':'done')+'"><td>'+esc(tituloDe(r.i))+'</td><td class="mono">'+r.i+'</td><td class="n">'+r.prev+'</td><td class="n">'+r.lido+'</td><td class="n">'+(f?'<strong>'+f+'</strong>':'<span class="pill p-ok">completo</span>')+'</td><td>'+(f?ondeAchar(r.i,ev):(r.o['soltos fora do plano']?'<span class="muted">soltos fora do plano</span>':''))+'</td></tr>'}).join('')||'<tr><td colspan="6" class="muted">Nada neste filtro.</td></tr>';
}
function render(){renderCounters();renderHist();renderBox();renderPend()}

/* ---------- fila de leituras (uma por vez, na ordem do bipe) ---------- */
var fila=Promise.resolve();
function enfileirar(fn){fila=fila.then(fn).catch(function(e){console.error(e);flash('err','NÃO REGISTRADO','Falha de conexão','A leitura não foi gravada. Confira a internet e leia de novo.');tone('ERR');setSync('err','SEM CONEXÃO')});return fila}
var token=lsGet('token','');
function rpc(nm,args,semToken){var a=Object.assign({},args);if(!semToken)a.p_token=token;return sb.rpc(nm,a).then(function(r){if(r.error){sessaoCaiu(r.error);throw r.error}return r.data})}
function sessaoCaiu(e){if(e&&(e.code==='28000'||/SESSAO_INVALIDA/.test(e.message||''))){lsSet('token','');token='';$('telaApp').classList.add('hidden');$('telaLogin').classList.remove('hidden');$('lgNome').value=nome;$('lgMsg').innerHTML='<div class="msg err">Sua sessão expirou ou a senha foi trocada. Entre de novo.</div>';$('lgSenha').focus();return true}return false}

/* ---------- caixa ---------- */
function normBox(s){s=(s||'').trim();if(!s)return '';if(/^s(\/?\s*caixa)?$|^avulso/i.test(s))return 'S/Caixa';var d=s.replace(/\D/g,'');return d?d.padStart(4,'0'):s}
function lerCaixa(){
  var notaEl=$('inNota'),cxEl=$('inCaixa'),raw=cxEl.value.trim(),dig=raw.replace(/\D/g,'');
  if(dig.length>=10){cxEl.value='';lerTitulo(raw);return}
  var nota=notaEl.value.replace(/\D/g,''),cx=normBox(raw);
  if(!cx&&nota){var l=NOTAS[+nota];if(!l){flash('err','NOTA NÃO ENCONTRADA',nota,'Esta nota não aparece na sobra do Experience.');tone('ERR');return}
    flash('abrir','NOTA '+nota,'',l.length+' caixa(s): '+l.join(', ')+'. Digite o número da caixa.');cxEl.focus();return}
  if(!cx){cxEl.focus();return}
  var b=BOX[cx];
  if(!b){flash('err','CAIXA NÃO ENCONTRADA',cx,'Esta caixa não está na sobra do Experience. Confira o número.');tone('ERR');return}
  if(!nota&&cx==='S/Caixa')nota=String(b.notas[0]);
  if(!nota){flash('err','INFORME A NOTA','Caixa '+cx,'Notas desta caixa: '+b.notas.join(', ')+'.');notaEl.focus();tone('ERR');return}
  if(nota&&b.notas.indexOf(+nota)<0){flash('err','NOTA NÃO CONFERE','Caixa '+cx+' · nota '+nota,'Notas desta caixa: '+b.notas.join(', ')+'. Confira antes de separar.');tone('ERR');return}
  cxEl.value='';notaEl.value='';
  enfileirar(async function(){
    var nf=+nota,its=itensFis(cx,nf),un=unidFis(cx,nf);
    var d=await rpc('sep_ler_caixa',{p_caixa:cx,p_nota:nf});
    if(d.status==='abrir'){cur=cx;curNota=nf;flash('abrir',d.situacao==='Avulso'?'AVULSOS: BIPAR UM A UM':'ABRIR A CAIXA','Caixa '+cx+' · NF '+nf+' · '+fmt(un)+' un','Bipe cada livro desta caixa para saber o destino. Conferidas: '+fmt(lidoFis(cx,nf))+'/'+fmt(un)+'.');tone('BOX');render();focusTit();return}
    if(d.status==='nao_encontrada'){flash('err','CAIXA NÃO ENCONTRADA',cx+' · NF '+nf,'');tone('ERR');return}
    var ev=d.situacao==='Inteira CBP'?'C':d.situacao==='Inteira CBTBE'?'E':'D',dest=DEST[ev],cls=DCLS[ev];
    if(d.status==='ja_lida'){flash(cls,dest,'Caixa '+cx+' · NF '+nf+' já foi lida','Destino: '+dest+'. Não registrei de novo. Se foi engano, reverta pelo histórico.');tone('ERR');return}
    its.forEach(function(r){var pl=plan(r);BK.forEach(function(k){if(pl[k])addLid('caixa',cx,r[0],k,pl[k])})});
    var comp=its.filter(function(r){return r[7]>0});
    flash(cls,dest,'Caixa '+cx+' · NF '+nf+(ev==='D'?' · não abrir: volta para o estoque':' · enviar fechada'),fmt(d.qtd)+' un registradas em '+dest+'.',comp.length?'<div class="compnote"><strong>Contém complemento do CBP:</strong> '+comp.map(function(r){return esc(r[1])+' ('+r[7]+' un)'}).join('; ')+'</div>':'');
    tone(ev);render();agendarRefresh();focusTit();
  });
}

/* ---------- título ---------- */
function qtdAtual(){var q=parseInt($('inQtd').value,10);return isFinite(q)&&q>0?Math.min(q,999):1}
function partesTxt(p){var o=[];[['C','CBP'],['K','CBP compl.'],['E','CBTBE'],['U','URGÊNCIA DEV'],['D','DEVOLUÇÃO POA'],['X','excedente (devolução)']].forEach(function(x){if(p&&p[x[0]])o.push(x[1]+' '+p[x[0]])});return o}
function lerTitulo(raw,qtdForcada){
  var i=(raw||'').replace(/[^0-9Xx]/g,'').toUpperCase();if(!i)return;
  var q=qtdForcada||qtdAtual();$('inQtd').value=1;
  if(!PED[i]&&!BYISBN[i]&&ALIAS[i])i=ALIAS[i];
  var cx=cur,cn=curNota;
  enfileirar(async function(){
    if(cx){
      var b=BOX[cx];
      var d=await rpc('sep_bipar_item',{p_caixa:cx,p_isbn:i,p_nota:cn,p_qtd:q});
      if(d.status==='nao_pertence'){var where=(BYISBN[i]||[]).map(function(x){return x.box+' (NF '+x.r[2]+')'});
        flash('err','NÃO É DESTA CAIXA',tituloDe(i),'Caixa ativa: '+cx+' · NF '+cn+'. '+(where.length?'Este título está nas caixas '+where.slice(0,8).join(', ')+'.':'Este título não está na sobra.')+' Se for um livro solto, feche a caixa ativa e bipe de novo.');tone('ERR');return}
      var pt=d.partes||{};pt[d.destino]=pt[d.destino]||1;['C','K','E','D','X'].forEach(function(z){if(pt[z])addLid('item',cx,i,z,pt[z])});
      var lst=partesTxt(pt);
      if(lst.length>1){var c2='Separe assim: <strong>'+lst.join(' · ')+'</strong>.';if(d.faltam_titulo>0)c2+=' Faltam '+d.faltam_titulo+' un deste título na caixa.';
        if(d.lido_caixa>=d.total_caixa){c2+=' <strong>Caixa '+cx+' · NF '+cn+' concluída.</strong>';if(cur===cx&&curNota===cn){cur=null;curNota=null}}
        flash('abrir','DIVIDIR '+q+' UN',d.descricao||tituloDe(i),c2);tone('BOX');render();agendarRefresh();return}
      var k=d.destino;
      if(q>1){var c3=q+' un para '+DEST[k]+(k==='K'?' (complemento)':k==='X'?' (excedente)':'')+'.';if(d.faltam_titulo>0)c3+=' Faltam '+d.faltam_titulo+' un deste título na caixa.';
        if(d.lido_caixa>=d.total_caixa){c3+=' <strong>Caixa '+cx+' · NF '+cn+' concluída.</strong>';if(cur===cx&&curNota===cn){cur=null;curNota=null}}
        flash(DCLS[k],(k==='K'?'CBP · COMPLEMENTO':DEST[k])+' · '+q+' UN',d.descricao||tituloDe(i),c3);tone(k);render();agendarRefresh();return}
      var c=k==='X'?'Unidade a mais do que o previsto nesta caixa (excedente): separar para devolução.':k==='K'?'Complemento do pedido CBP: unidade '+d.n+' de '+d.previsto+'.':'Unidade '+d.n+' de '+d.previsto+' deste título para '+DEST[k]+'.';
      if(d.faltam_titulo>0)c+=' Faltam '+d.faltam_titulo+' un deste título na caixa.';
      if(d.lido_caixa>=d.total_caixa){c+=' <strong>Caixa '+cx+' · NF '+cn+' concluída.</strong>';if(cur===cx&&curNota===cn){cur=null;curNota=null}}
      flash(DCLS[k],k==='K'?'CBP · COMPLEMENTO':DEST[k],d.descricao||tituloDe(i),c);tone(k);render();agendarRefresh();return}
    var s=await rpc('sep_bipar_solto',{p_isbn:i,p_prioridade:$('prio').value,p_qtd:q});
    var ps=s.partes||{};if(!s.partes)ps[s.destino]=1;['C','E','U','D'].forEach(function(z){if(ps[z])addLid('solto','',i,z,ps[z])});
    var nm=s.titulo||tituloDe(i);
    if(q>1){var ls=partesTxt(ps),dv2=s.dev||{};
      var cls2=ls.length>1?'abrir':ps.C?'cbp':ps.E?'cbtbe':ps.U?'urg':'dev',big=ls.length>1?'DIVIDIR '+q+' UN':(ps.C?'CBP':ps.E?'CBTBE':ps.U?'URGÊNCIA DEV':'DEVOLUÇÃO POA')+' · '+q+' UN';
      var extra2=(ps.D&&dv2.soltos>dv2.precisa)?' Atenção: a devolução deste título passou do previsto ('+dv2.soltos+' de '+dv2.precisa+'). Confira a quantidade.':'';
      flash(cls2,big,nm,'Livro solto: separe <strong>'+ls.join(' · ')+'</strong>.'+extra2);tone(ls.length>1?'BOX':ps.C?'C':ps.E?'E':ps.U?'U':'D');render();agendarRefresh();return}
    if(s.destino==='U'){var ug=s.urg||{},fu=Math.max(0,(ug.precisa||0)-(ug.soltos||0));flash('urg','URGÊNCIA DEV',nm,'Urgência de devolução: unidade '+ug.soltos+' de '+ug.precisa+'.'+(fu?' Faltam '+fu+'.':' Urgência deste título completa.'));tone('U')}
    else if(s.destino==='D'){var dv=s.dev||{},fd=Math.max(0,(dv.precisa||0)-(dv.soltos||0));flash('dev','DEVOLUÇÃO POA',nm,!s.no_pedido?'Este título não está no plano. Separe para devolução e avise o responsável.':(dv.soltos<=dv.precisa?'Livro solto: unidade '+dv.soltos+' de '+dv.precisa+' da devolução POA.'+(fd?' Faltam '+fd+'.':' Devolução deste título completa.'):'CBP, CBTBE e devolução previstos já completos: esta unidade passa do estoque previsto. Avise o responsável.'));tone('D')}
    else{var ev=s.destino==='C'?'CBP':'CBTBE',me=s.destino==='C'?s.cbp:s.cbtbe,ot=s.destino==='C'?s.cbtbe:s.cbp,o=s.destino==='C'?'CBTBE':'CBP';
      var fm=Math.max(0,me.precisa-me.soltos),fo=Math.max(0,ot.precisa-ot.soltos);
      flash(s.destino==='C'?'cbp':'cbtbe',ev,nm,'Livro solto: unidade '+me.soltos+' de '+me.precisa+' que faltam no '+ev+'.'+(fm?' Faltam '+fm+'.':' '+ev+' completo neste título.')+(fo?' '+o+' ainda precisa de '+fo+'.':''));tone(s.destino)}
    render();agendarRefresh();
  });
}


/* ---------- leitura pela câmera do celular ---------- */
var camPendente=null,camAberta=false,leitor=null,camPronto=true,camVisto=0,camLido=0,camTimer=null;
var CAM_LIB='https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
function carregarLib(){return new Promise(function(ok,erro){if(window.Html5Qrcode)return ok();var sc=document.createElement('script');sc.src=CAM_LIB;sc.onload=function(){ok()};sc.onerror=function(){erro(new Error('Não foi possível carregar o leitor da câmera.'))};document.head.appendChild(sc)})}
function camEstado(txt,pronto){var e=$('camEstado');e.textContent=txt;e.className='cam-estado'+(pronto?' pronto':'')}
function camCtx(){$('camCtx').textContent=cur?('Caixa ativa '+cur+' · NF '+curNota+' · '+(sitFis(cur,curNota)||'')):'Livros soltos (sem caixa ativa)'}
async function abrirCamera(){
  audioAtivar();
  if(camAberta)return;
  camAberta=true;$('cam').classList.remove('hidden');document.body.style.overflow='hidden';
  $('camRes').className='cam-res';$('camRes').innerHTML='<div class="dest">Aponte para o código de barras</div>';camCtx();camEstado('Iniciando câmera…');
  try{
    await carregarLib();
    leitor=new Html5Qrcode('camView',{formatsToSupport:[Html5QrcodeSupportedFormats.EAN_13],verbose:false,experimentalFeatures:{useBarCodeDetectorIfSupported:true}});
    await leitor.start({facingMode:'environment'},{fps:12,qrbox:function(w,h){var lw=Math.floor(Math.min(w*0.85,420));return {width:lw,height:Math.floor(lw*0.45)}}},lidoCamera,function(){});
    camPronto=true;camEstado('Pronto: aponte para o código de barras',true);
    clearInterval(camTimer);
    camTimer=setInterval(function(){if(!camPronto&&!camPendente&&Date.now()-camVisto>800&&Date.now()-camLido>1500){camPronto=true;camEstado('Pronto para o próximo livro',true)}},150);
  }catch(e){
    var m=String(e&&e.message||e);
    camEstado(/Permission|NotAllowed|denied/i.test(m)?'Sem permissão para usar a câmera. Libere a câmera nas configurações do navegador.':'Não foi possível abrir a câmera: '+m);
  }
}
function lidoCamera(texto){
  camVisto=Date.now();
  if(!camPronto)return;
  var d=String(texto||'').replace(/\D/g,'');
  if(d.length!==13||!/^97[89]/.test(d)){camEstado('Este código não é um ISBN de livro');return}
  camPronto=false;camLido=Date.now();
  camEstado('Lido '+d+' · afaste o livro para ler o próximo');
  beep(1600,.09,1);
  try{navigator.vibrate&&navigator.vibrate(120)}catch(e){}
  if($('modoQtd').checked){camPendente=d;$('camQtdTit').textContent=tituloDe(d)+' ('+d+')';$('camQtd').value=1;$('camQtdBox').classList.remove('hidden');camEstado('Digite a quantidade e toque em Registrar');$('camQtd').focus();$('camQtd').select();return}
  lerTitulo(d);
  setTimeout(camCtx,400);
}
async function fecharCamera(){
  clearInterval(camTimer);camPendente=null;$('camQtdBox').classList.add('hidden');
  try{if(leitor){await leitor.stop();leitor.clear()}}catch(e){}
  leitor=null;camAberta=false;$('cam').classList.add('hidden');document.body.style.overflow='';
}
$('btnCam').addEventListener('click',abrirCamera);
function camQtdFechar(){camPendente=null;$('camQtdBox').classList.add('hidden');camLido=Date.now();camVisto=Date.now()}
$('camQtdOk').addEventListener('click',function(){if(!camPendente)return;var q=parseInt($('camQtd').value,10);q=isFinite(q)&&q>0?Math.min(q,999):1;var p=camPendente;camQtdFechar();lerTitulo(p,q);setTimeout(camCtx,400)});
$('camQtd').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();$('camQtdOk').click()}});
$('camQtdCancel').addEventListener('click',function(){camQtdFechar();camEstado('Leitura cancelada. Afaste o livro para ler o próximo.')});
$('camFechar').addEventListener('click',fecharCamera);
$('camUndo').addEventListener('click',function(){var h=HIST.filter(function(x){return !x.rev&&x.quem===nome})[0];if(h)reverter(h.grupo);else camEstado('Nenhuma leitura sua para reverter')});
document.addEventListener('visibilitychange',function(){if(document.hidden&&camAberta)fecharCamera()});

/* ---------- busca no histórico ---------- */
function normHist(h){var m={};(h.dest||[]).forEach(function(k){m[k]=1});h.dest=m;return h}
async function buscarHist(){var q=$('histQ').value.trim();if(!q||(q.length<2&&!/^\d+$/.test(q))){HISTB=null;return}
  var d=await rpc('sep_buscar_leituras',{p_q:q});HISTB=(d||[]).map(normHist)}
$('histQ').addEventListener('input',function(){clearTimeout(histT);histT=setTimeout(async function(){try{await buscarHist()}catch(e){}renderHist()},350)});

/* ---------- reverter ---------- */
function reverter(grupo){
  enfileirar(async function(){
    var h=(HISTB||[]).concat(HIST).filter(function(x){return x.grupo===grupo})[0];
    var d=await rpc('sep_reverter',{p_grupo:grupo});
    if(d.status==='ja_revertida'){flash('dev','JÁ REVERTIDA',h?h.rotulo:'','Esta leitura já tinha sido revertida.');}
    else{var dl=h?destLabel(h)[0]:'';flash('err','REVERTIDO',h?h.rotulo:'',(h&&h.tipo==='caixa'?'Leitura da caixa desfeita: '+d.qtd+' un retiradas de ':'Retire esta unidade de ')+dl+'. Contadores ajustados.');beep(500,.15,1)}
    await carregarEstado();if(HISTB)await buscarHist();render();focusTit();
  });
}
$('hist').addEventListener('click',function(e){var b=e.target.closest('[data-rev]');if(!b)return;var g=b.dataset.rev;
  if(armed===g){armed=null;clearTimeout(armT);reverter(g);return}
  armed=g;clearTimeout(armT);armT=setTimeout(function(){armed=null;renderHist()},5000);renderHist()});
$('btnUndo').addEventListener('click',function(){var h=HIST.filter(function(x){return !x.rev&&x.quem===nome})[0];if(h)reverter(h.grupo)});

/* ---------- eventos de entrada ---------- */
$('inNota').addEventListener('keydown',function(e){if(e.key!=='Enter')return;e.preventDefault();if($('inCaixa').value.trim())lerCaixa();else{var v=this.value.replace(/\D/g,'');if(v.length>=10){this.value='';lerTitulo(v)}else $('inCaixa').focus()}});
$('inCaixa').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();lerCaixa()}});
$('fCaixa').addEventListener('submit',function(e){e.preventDefault();$('inCaixa').blur();lerCaixa()});
$('fNota').addEventListener('submit',function(e){e.preventDefault();if($('inCaixa').value.trim())lerCaixa();else $('inCaixa').focus()});
$('fTit').addEventListener('submit',function(e){e.preventDefault();var ev=new KeyboardEvent('keydown',{key:'Enter'});$('inTit').dispatchEvent(ev)});
$('fQtd').addEventListener('submit',function(e){e.preventDefault();var ev=new KeyboardEvent('keydown',{key:'Enter'});$('inQtd').dispatchEvent(ev)});
var pendIsbn=null;
function mostrarPend(){var el=$('pend1');if(!pendIsbn){el.innerHTML='';return}el.innerHTML='<div class="pendente">Lido <b>'+esc(tituloDe(pendIsbn))+'</b> ('+pendIsbn+'). Digite a quantidade e tecle Enter. <button class="btn sm" id="pendCancel">Cancelar</button></div>';$('pendCancel').onclick=function(){pendIsbn=null;mostrarPend();focusTit()}}
$('modoQtd').checked=lsGet('modoQtd','0')==='1';
$('modoQtd').addEventListener('change',function(){lsSet('modoQtd',this.checked?'1':'0');pendIsbn=null;mostrarPend()});
$('inQtd').addEventListener('keydown',function(e){if(e.key!=='Enter')return;e.preventDefault();
  if(pendIsbn){var p=pendIsbn;pendIsbn=null;mostrarPend();lerTitulo(p);$('inTit').focus()}else $('inTit').focus()});
$('inTit').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();var v=this.value;this.value='';
  if($('modoQtd').checked){var i2=v.replace(/[^0-9Xx]/g,'').toUpperCase();if(!i2)return;if(!PED[i2]&&!BYISBN[i2]&&ALIAS[i2])i2=ALIAS[i2];pendIsbn=i2;mostrarPend();$('inQtd').value=1;$('inQtd').focus();$('inQtd').select();return}
  lerTitulo(v);this.focus()}});
function onCtr(e){var c=e.target.closest('.ctr');if(!c)return;if(e.type==='keydown'){if(e.key!=='Enter'&&e.key!==' ')return;e.preventDefault()}
  sel=(sel===c.dataset.ev)?null:c.dataset.ev;$('pQ').value='';render();if(sel)setTimeout(function(){$('lista').scrollIntoView({behavior:'smooth',block:'start'})},30)}
$('counters').addEventListener('click',onCtr);$('counters').addEventListener('keydown',onCtr);
$('lstClose').addEventListener('click',function(){sel=null;render();focusTit()});
$('pSt').addEventListener('change',renderPend);$('pQ').addEventListener('input',renderPend);
$('prio').value=lsGet('prio','CBP');$('prio').addEventListener('change',function(){lsSet('prio',this.value)});
$('btnCsv').addEventListener('click',function(){
  var L=['Destino;ISBN;Titulo;Previsto;Lido;Falta;Origem'];
  ['CBP','CBTBE','URG','DEV'].forEach(function(ev){pendRows(ev).forEach(function(r){L.push([ev==='DEV'?'DEVOLUCAO':ev==='URG'?'URGENCIA_DEV':ev,r.i,'"'+tituloDe(r.i).replace(/"/g,'""')+'"',r.prev,r.lido,Math.max(0,r.prev-r.lido),Object.keys(r.o).join('+')].join(';'))})});
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+L.join('\n')],{type:'text/csv;charset=utf-8'}));a.download='separacao_CBP_CBTBE_devolucao.csv';document.body.appendChild(a);a.click();a.remove();
});

/* ---------- plano do repositório ---------- */
var planoArmado=false;
async function planoRepo(){var r=await fetch('dados/plano.json',{cache:'no-store'});if(!r.ok)throw new Error('dados/plano.json não encontrado');return r.json()}
async function verificarPlano(){
  var atual=PLANO_INFO,repo=null;try{repo=await planoRepo()}catch(e){}
  $('planoInfo').textContent=atual?'Plano no banco: '+atual.versao+' (carregado em '+new Date(atual.carregado_em).toLocaleString('pt-BR')+')'+(repo?' · no repositório: '+repo.versao:''):'Nenhum plano carregado ainda.';
  var av=$('planoAviso');
  if(!atual){av.innerHTML='<div class="ctx" style="margin-bottom:14px"><span>O plano de separação ainda não foi carregado no banco.</span><button class="btn sm primary" id="btnPlanoAviso">Carregar plano '+(repo?esc(repo.versao):'')+'</button></div>';$('btnPlanoAviso').onclick=carregarPlanoRepo}
  else if(repo&&repo.versao!==atual.versao){av.innerHTML='<div class="ctx" style="margin-bottom:14px"><span>Há um plano novo no repositório (<b>'+esc(repo.versao)+'</b>). O banco está com '+esc(atual.versao)+'.</span><button class="btn sm" id="btnPlanoAviso">Carregar plano novo</button></div>';$('btnPlanoAviso').onclick=carregarPlanoRepo}
  else av.innerHTML='';
}
async function carregarPlanoRepo(){
  try{
    var p=await planoRepo();
    var d=await rpc('sep_carregar_plano',{p:p,p_forcar:planoArmado});
    if(d.status==='tem_leituras'){planoArmado=true;flash('err','ATENÇÃO','Já existem '+fmt(d.leituras)+' leituras registradas','Carregar o plano novo vai REVERTER todas as leituras atuais. Clique de novo em carregar para confirmar.');setTimeout(function(){planoArmado=false},10000);return}
    planoArmado=false;
    flash('cbtbe','PLANO CARREGADO',p.versao,fmt(d.caixas)+' caixas, '+fmt(d.itens)+' itens, '+fmt(d.pedidos)+' linhas de pedido.');
    await iniciarDados();
  }catch(e){flash('err','FALHA AO CARREGAR PLANO','',esc(e.message||e))}
}
$('btnPlano').addEventListener('click',carregarPlanoRepo);

/* ---------- login ---------- */
async function entrar(){
  var senha=$('lgSenha').value,n=$('lgNome').value.trim();
  if(!n){$('lgMsg').innerHTML='<div class="msg err">Informe seu nome.</div>';return}
  $('lgEntrar').disabled=true;$('lgMsg').innerHTML='';
  var d=null;try{d=await rpc('sep_login',{p_senha:senha,p_nome:n},true)}catch(e){d={status:'erro'}}
  $('lgEntrar').disabled=false;
  var msgs={senha_invalida:'Senha incorreta.',bloqueado:'Muitas tentativas erradas. Aguarde 15 minutos.',sem_senha:'A senha da equipe ainda não foi definida no Supabase.',erro:'Sem conexão com o servidor. Tente de novo.'};
  if(!d||d.status!=='ok'){$('lgMsg').innerHTML='<div class="msg err">'+(msgs[d&&d.status]||msgs.erro)+'</div>';return}
  token=d.token;lsSet('token',token);nome=n;lsSet('nome',n);$('lgSenha').value='';iniciarApp();
}
$('lgEntrar').addEventListener('click',entrar);
$('lgSenha').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();$('lgNome').value.trim()?entrar():$('lgNome').focus()}});
$('lgNome').addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();entrar()}});
$('btnSair').addEventListener('click',async function(){try{await rpc('sep_logout',{})}catch(e){}lsSet('token','');location.reload()});

async function iniciarDados(){
  await carregarPlanoDoBanco();await carregarEstado();render();await verificarPlano();
}
var poll=null;
async function iniciarApp(){
  $('telaLogin').classList.add('hidden');$('telaApp').classList.remove('hidden');
  $('quem').textContent=nome?'Bipando como '+nome:'';
  try{await iniciarDados();setSync('ok','SINCRONIZADO')}
  catch(e){if(!sessaoCaiu(e)){setSync('err','SEM CONEXÃO');flash('err','FALHA AO CARREGAR','',esc(e.message||e))}return}
  if(!poll)poll=setInterval(function(){if(token&&!document.hidden)agendarRefresh(10)},5000);
  if(!TOQUE)$('inNota').focus();
}
if(token&&nome)iniciarApp();
else{$('telaLogin').classList.remove('hidden');$('lgNome').value=nome;$('lgSenha').focus()}
})();
