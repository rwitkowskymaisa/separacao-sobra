-- Login próprio do sistema de separação (senha única da equipe), independente do
-- cadastro de usuários do Controle de eventos: não cria nada em auth.users nem em profiles.
-- A página só conversa com o banco por funções (RPC) que recebem o token da sessão.

-- 1) remove o acesso pelo Supabase Auth
drop policy if exists sep_caixas_ler on public.sep_caixas;
drop policy if exists sep_itens_ler on public.sep_itens;
drop policy if exists sep_pedidos_ler on public.sep_pedidos;
drop policy if exists sep_leituras_ler on public.sep_leituras;
drop policy if exists sep_leituras_inserir on public.sep_leituras;
drop policy if exists sep_leituras_reverter on public.sep_leituras;
drop policy if exists sep_plano_info_ler on public.sep_plano_info;
drop function if exists public.sep_ler_caixa(text,text);
drop function if exists public.sep_bipar_item(text,text,text);
drop function if exists public.sep_bipar_solto(text,text,text);
drop function if exists public.sep_reverter(uuid);
drop function if exists public.sep_carregar_plano(jsonb,boolean);
drop function if exists public.sep_autorizado();
drop table if exists public.sep_acesso;
revoke all on public.sep_caixas, public.sep_itens, public.sep_pedidos, public.sep_plano_info, public.sep_leituras, public.sep_lidos from anon, authenticated;
alter table public.sep_leituras drop column if exists usuario;
do $$ begin alter publication supabase_realtime drop table public.sep_leituras; exception when others then null; end $$;

-- 2) senha e sessões
create table if not exists public.sep_config (
  id int primary key default 1 check (id = 1),
  senha_hash text not null,
  atualizado_em timestamptz not null default now()
);
create table if not exists public.sep_sessoes (
  token uuid primary key default gen_random_uuid(),
  nome text not null,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '30 days'
);
create table if not exists public.sep_tentativas (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  ok boolean not null
);
alter table public.sep_config enable row level security;
alter table public.sep_sessoes enable row level security;
alter table public.sep_tentativas enable row level security;
revoke all on public.sep_config, public.sep_sessoes, public.sep_tentativas from anon, authenticated;

-- Definir/trocar a senha da equipe: rodar no SQL Editor do Supabase
--   select public.sep_definir_senha('a-senha-da-equipe');
create or replace function public.sep_definir_senha(p_senha text)
returns text language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(coalesce(p_senha,'')) < 6 then raise exception 'A senha precisa ter pelo menos 6 caracteres'; end if;
  insert into public.sep_config(id, senha_hash, atualizado_em) values (1, extensions.crypt(p_senha, extensions.gen_salt('bf')), now())
    on conflict (id) do update set senha_hash = excluded.senha_hash, atualizado_em = now();
  delete from public.sep_sessoes;
  return 'Senha definida. Quem estiver conectado precisará entrar de novo.';
end $$;
revoke all on function public.sep_definir_senha(text) from public, anon, authenticated;

create or replace function public.sep_login(p_senha text, p_nome text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text; v_falhas int; v_token uuid;
begin
  select count(*) into v_falhas from public.sep_tentativas where not ok and em > now() - interval '15 minutes';
  if v_falhas >= 20 then return jsonb_build_object('status','bloqueado'); end if;
  select senha_hash into v_hash from public.sep_config where id = 1;
  if v_hash is null then return jsonb_build_object('status','sem_senha'); end if;
  if extensions.crypt(coalesce(p_senha,''), v_hash) <> v_hash then
    insert into public.sep_tentativas(ok) values (false);
    return jsonb_build_object('status','senha_invalida');
  end if;
  delete from public.sep_sessoes where expira_em < now();
  delete from public.sep_tentativas where em < now() - interval '1 day';
  insert into public.sep_sessoes(nome) values (left(coalesce(nullif(trim(p_nome),''),'sem nome'),60)) returning token into v_token;
  return jsonb_build_object('status','ok','token',v_token);
end $$;

create or replace function public.sep_sessao(p_token uuid)
returns text language sql stable security definer set search_path = public as $$
  select nome from public.sep_sessoes where token = p_token and expira_em > now();
$$;
revoke all on function public.sep_sessao(uuid) from public, anon, authenticated;

create or replace function public.sep_exigir(p_token uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  v := public.sep_sessao(p_token);
  if v is null then raise exception 'SESSAO_INVALIDA' using errcode = '28000'; end if;
  return v;
end $$;
revoke all on function public.sep_exigir(uuid) from public, anon, authenticated;

create or replace function public.sep_logout(p_token uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.sep_sessoes where token = p_token;
$$;

-- 3) leitura de dados
create or replace function public.sep_plano(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sep_exigir(p_token);
  return jsonb_build_object(
    'info', (select to_jsonb(i) from public.sep_plano_info i where id = 1),
    'caixas', coalesce((select jsonb_agg(jsonb_build_array(id,situacao,convertida,notas) order by id) from public.sep_caixas),'[]'),
    'itens', coalesce((select jsonb_agg(jsonb_build_array(caixa,isbn,descricao,nota,estoque,cbp,comp,cbtbe,dev)) from public.sep_itens),'[]'),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_array(isbn,evento,titulo,qtd)) from public.sep_pedidos),'[]'));
end $$;

create or replace function public.sep_estado(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.sep_exigir(p_token);
  return jsonb_build_object(
    'versao', (select versao from public.sep_plano_info where id = 1),
    'lidos', coalesce((select jsonb_agg(jsonb_build_array(tipo,caixa,isbn,destino,qtd)) from public.sep_lidos),'[]'),
    'hist', coalesce((select jsonb_agg(h order by h.ts desc) from (
        select grupo, min(criado_em) ts, min(tipo) tipo, min(caixa) caixa, min(rotulo) rotulo, min(dispositivo) quem,
               bool_and(revertida) rev, sum(qtd)::int q, jsonb_agg(distinct destino) dest
        from public.sep_leituras
        where grupo in (select grupo from public.sep_leituras order by id desc limit 400)
        group by grupo order by min(id) desc limit 80) h),'[]'));
end $$;

-- 4) leituras (o destino é decidido aqui, com trava por caixa/título)
create or replace function public.sep_ler_caixa(p_token uuid, p_caixa text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_quem text; v_cx public.sep_caixas; v_grupo uuid := gen_random_uuid(); v_q int := 0; r record; v_rot text;
begin
  v_quem := public.sep_exigir(p_token);
  perform pg_advisory_xact_lock(hashtext('sep:cx:' || p_caixa));
  select * into v_cx from public.sep_caixas where id = p_caixa;
  if not found then return jsonb_build_object('status','nao_encontrada'); end if;
  if v_cx.situacao in ('Aberta','Avulso') then return jsonb_build_object('status','abrir','situacao',v_cx.situacao); end if;
  if exists (select 1 from public.sep_leituras where caixa = p_caixa and tipo = 'caixa' and not revertida) then
    return jsonb_build_object('status','ja_lida','situacao',v_cx.situacao);
  end if;
  v_rot := 'Caixa '||p_caixa||' (fechada)';
  for r in select * from public.sep_itens where caixa = p_caixa loop
    if v_cx.situacao = 'Inteira CBP' then
      if r.cbp - r.comp > 0 then insert into public.sep_leituras(grupo,tipo,caixa,isbn,destino,qtd,rotulo,dispositivo) values (v_grupo,'caixa',p_caixa,r.isbn,'C',r.cbp - r.comp,v_rot,v_quem); end if;
      if r.comp > 0 then insert into public.sep_leituras(grupo,tipo,caixa,isbn,destino,qtd,rotulo,dispositivo) values (v_grupo,'caixa',p_caixa,r.isbn,'K',r.comp,v_rot,v_quem); end if;
    elsif v_cx.situacao = 'Inteira CBTBE' then
      insert into public.sep_leituras(grupo,tipo,caixa,isbn,destino,qtd,rotulo,dispositivo) values (v_grupo,'caixa',p_caixa,r.isbn,'E',r.estoque,v_rot,v_quem);
    else
      insert into public.sep_leituras(grupo,tipo,caixa,isbn,destino,qtd,rotulo,dispositivo) values (v_grupo,'caixa',p_caixa,r.isbn,'D',r.estoque,v_rot,v_quem);
    end if;
    v_q := v_q + r.estoque;
  end loop;
  return jsonb_build_object('status','ok','situacao',v_cx.situacao,'grupo',v_grupo,'qtd',v_q);
end $$;

create or replace function public.sep_bipar_item(p_token uuid, p_caixa text, p_isbn text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_quem text; v_it public.sep_itens; c int; k int; e int; d int; v_dest text; v_n int; v_prev int;
        v_grupo uuid := gen_random_uuid(); v_tot int; v_lid_cx int;
begin
  v_quem := public.sep_exigir(p_token);
  perform pg_advisory_xact_lock(hashtext('sep:cx:' || p_caixa));
  select * into v_it from public.sep_itens where caixa = p_caixa and isbn = p_isbn;
  if not found then return jsonb_build_object('status','nao_pertence'); end if;
  select coalesce(sum(qtd) filter (where destino='C'),0), coalesce(sum(qtd) filter (where destino='K'),0),
         coalesce(sum(qtd) filter (where destino='E'),0), coalesce(sum(qtd) filter (where destino='D'),0)
    into c,k,e,d from public.sep_leituras where caixa = p_caixa and isbn = p_isbn and tipo = 'item' and not revertida;
  if c < v_it.cbp - v_it.comp then v_dest := 'C'; v_n := c + 1; v_prev := v_it.cbp - v_it.comp;
  elsif k < v_it.comp then v_dest := 'K'; v_n := k + 1; v_prev := v_it.comp;
  elsif e < v_it.cbtbe then v_dest := 'E'; v_n := e + 1; v_prev := v_it.cbtbe;
  elsif d < v_it.dev then v_dest := 'D'; v_n := d + 1; v_prev := v_it.dev;
  else v_dest := 'X'; v_n := 1; v_prev := 0; end if;
  insert into public.sep_leituras(grupo,tipo,caixa,isbn,destino,qtd,rotulo,dispositivo)
    values (v_grupo,'item',p_caixa,p_isbn,v_dest,1,v_it.descricao||' (cx '||p_caixa||')',v_quem);
  select sum(estoque) into v_tot from public.sep_itens where caixa = p_caixa;
  select coalesce(sum(qtd),0) into v_lid_cx from public.sep_leituras where caixa = p_caixa and tipo='item' and destino <> 'X' and not revertida;
  return jsonb_build_object('status','ok','destino',v_dest,'n',v_n,'previsto',v_prev,'grupo',v_grupo,
    'faltam_titulo', greatest(0, v_it.estoque - (c+k+e+d) - case when v_dest='X' then 0 else 1 end),
    'lido_caixa', v_lid_cx, 'total_caixa', v_tot, 'descricao', v_it.descricao);
end $$;

create or replace function public.sep_bipar_solto(p_token uuid, p_isbn text, p_prioridade text default 'CBP')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_quem text; v_ped_c int; v_ped_e int; v_sob_c int; v_sob_e int; v_got_c int; v_got_e int; v_need_c int; v_need_e int;
        v_dest text; v_grupo uuid := gen_random_uuid(); v_tit text;
begin
  v_quem := public.sep_exigir(p_token);
  perform pg_advisory_xact_lock(hashtext('sep:solto:' || p_isbn));
  select coalesce(max(qtd) filter (where evento='CBP'),0), coalesce(max(qtd) filter (where evento='CBTBE'),0), max(titulo)
    into v_ped_c, v_ped_e, v_tit from public.sep_pedidos where isbn = p_isbn;
  if v_tit is null then select max(descricao) into v_tit from public.sep_itens where isbn = p_isbn; end if;
  select coalesce(sum(cbp - comp),0), coalesce(sum(cbtbe),0) into v_sob_c, v_sob_e from public.sep_itens where isbn = p_isbn;
  select coalesce(sum(qtd) filter (where destino='C'),0), coalesce(sum(qtd) filter (where destino='E'),0)
    into v_got_c, v_got_e from public.sep_leituras where isbn = p_isbn and tipo='solto' and not revertida;
  v_need_c := greatest(0, v_ped_c - v_sob_c); v_need_e := greatest(0, v_ped_e - v_sob_e);
  if coalesce(p_prioridade,'CBP') = 'CBTBE' then
    if v_got_e < v_need_e then v_dest := 'E'; elsif v_got_c < v_need_c then v_dest := 'C'; else v_dest := 'D'; end if;
  else
    if v_got_c < v_need_c then v_dest := 'C'; elsif v_got_e < v_need_e then v_dest := 'E'; else v_dest := 'D'; end if;
  end if;
  insert into public.sep_leituras(grupo,tipo,isbn,destino,qtd,rotulo,dispositivo)
    values (v_grupo,'solto',p_isbn,v_dest,1,coalesce(v_tit,p_isbn)||' (solto)',v_quem);
  if v_dest='C' then v_got_c := v_got_c + 1; elsif v_dest='E' then v_got_e := v_got_e + 1; end if;
  return jsonb_build_object('status','ok','destino',v_dest,'grupo',v_grupo,'titulo',v_tit,
    'no_pedido', (v_ped_c + v_ped_e) > 0,
    'cbp', jsonb_build_object('pedido',v_ped_c,'sobra',v_sob_c,'soltos',v_got_c,'precisa',v_need_c),
    'cbtbe', jsonb_build_object('pedido',v_ped_e,'sobra',v_sob_e,'soltos',v_got_e,'precisa',v_need_e));
end $$;

create or replace function public.sep_reverter(p_token uuid, p_grupo uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int; v_q int;
begin
  perform public.sep_exigir(p_token);
  update public.sep_leituras set revertida = true, revertida_em = now() where grupo = p_grupo and not revertida;
  get diagnostics v_n = row_count;
  select coalesce(sum(qtd),0) into v_q from public.sep_leituras where grupo = p_grupo;
  return jsonb_build_object('status', case when v_n > 0 then 'ok' else 'ja_revertida' end, 'qtd', v_q);
end $$;

create or replace function public.sep_carregar_plano(p_token uuid, p jsonb, p_forcar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_quem text; v_lidas int; v_cx int; v_it int; v_pd int;
begin
  v_quem := public.sep_exigir(p_token);
  if p ? 'versao' is false or p ? 't' is false or p ? 'b' is false or p ? 'p' is false then raise exception 'PLANO_INVALIDO'; end if;
  perform pg_advisory_xact_lock(hashtext('sep:plano'));
  select count(*) into v_lidas from public.sep_leituras where not revertida;
  if v_lidas > 0 and not p_forcar then return jsonb_build_object('status','tem_leituras','leituras',v_lidas); end if;
  if v_lidas > 0 then update public.sep_leituras set revertida = true, revertida_em = now() where not revertida; end if;
  delete from public.sep_itens; delete from public.sep_caixas; delete from public.sep_pedidos;
  create temporary table _t on commit drop as
    select (e.ord-1)::int ix, e.v->>0 isbn, e.v->>1 descr, nullif(e.v->>2,'') tit
    from jsonb_array_elements(p->'t') with ordinality e(v,ord);
  insert into public.sep_caixas(id,situacao,convertida,notas)
    select b->>0, b->>1, (b->>2)::int=1, array(select jsonb_array_elements_text(b->3)::int) from jsonb_array_elements(p->'b') b;
  get diagnostics v_cx = row_count;
  insert into public.sep_itens(caixa,isbn,descricao,nota,estoque,cbp,comp,cbtbe,dev)
    select b->>0, t.isbn, t.descr, (r->>1)::int,(r->>2)::int,(r->>3)::int,(r->>4)::int,(r->>5)::int,(r->>6)::int
    from jsonb_array_elements(p->'b') b, jsonb_array_elements(b->4) r join _t t on t.ix=(r->>0)::int;
  get diagnostics v_it = row_count;
  insert into public.sep_pedidos(isbn,evento,titulo,autor,qtd)
    select t.isbn, x->>1, coalesce(t.tit,t.descr), x->>3, (x->>2)::int from jsonb_array_elements(p->'p') x join _t t on t.ix=(x->>0)::int;
  get diagnostics v_pd = row_count;
  insert into public.sep_plano_info(id,versao,carregado_em,carregado_por) values (1,p->>'versao',now(),v_quem)
    on conflict (id) do update set versao = excluded.versao, carregado_em = excluded.carregado_em, carregado_por = excluded.carregado_por;
  return jsonb_build_object('status','ok','caixas',v_cx,'itens',v_it,'pedidos',v_pd,'versao',p->>'versao');
end $$;

-- 5) quem pode chamar o quê pela página
revoke all on function public.sep_login(text,text), public.sep_logout(uuid), public.sep_plano(uuid), public.sep_estado(uuid),
  public.sep_ler_caixa(uuid,text), public.sep_bipar_item(uuid,text,text), public.sep_bipar_solto(uuid,text,text),
  public.sep_reverter(uuid,uuid), public.sep_carregar_plano(uuid,jsonb,boolean) from public;
grant execute on function public.sep_login(text,text), public.sep_logout(uuid), public.sep_plano(uuid), public.sep_estado(uuid),
  public.sep_ler_caixa(uuid,text), public.sep_bipar_item(uuid,text,text), public.sep_bipar_solto(uuid,text,text),
  public.sep_reverter(uuid,uuid), public.sep_carregar_plano(uuid,jsonb,boolean) to anon, authenticated;
