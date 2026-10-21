-- Funções de leitura: decidem o destino no servidor, com trava por caixa/título,
-- para duas pessoas bipando ao mesmo tempo não passarem da quantidade prevista.

create or replace function public.sep_ler_caixa(p_caixa text, p_dispositivo text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_cx public.sep_caixas; v_grupo uuid := gen_random_uuid(); v_q int := 0; v_dest text; r record;
begin
  if not public.sep_autorizado() then raise exception 'NAO_AUTORIZADO'; end if;
  perform pg_advisory_xact_lock(hashtext('sep:cx:' || p_caixa));
  select * into v_cx from public.sep_caixas where id = p_caixa;
  if not found then return jsonb_build_object('status','nao_encontrada'); end if;
  if v_cx.situacao in ('Aberta','Avulso') then
    return jsonb_build_object('status','abrir','situacao',v_cx.situacao);
  end if;
  if exists (select 1 from public.sep_leituras where caixa = p_caixa and tipo = 'caixa' and not revertida) then
    return jsonb_build_object('status','ja_lida','situacao',v_cx.situacao);
  end if;
  for r in select * from public.sep_itens where caixa = p_caixa loop
    if v_cx.situacao = 'Inteira CBP' then
      if r.cbp - r.comp > 0 then insert into public.sep_leituras(grupo,tipo,caixa,isbn,destino,qtd,rotulo,dispositivo) values (v_grupo,'caixa',p_caixa,r.isbn,'C',r.cbp - r.comp,'Caixa '||p_caixa||' (fechada)',p_dispositivo); end if;
      if r.comp > 0 then insert into public.sep_leituras(grupo,tipo,caixa,isbn,destino,qtd,rotulo,dispositivo) values (v_grupo,'caixa',p_caixa,r.isbn,'K',r.comp,'Caixa '||p_caixa||' (fechada)',p_dispositivo); end if;
    elsif v_cx.situacao = 'Inteira CBTBE' then
      insert into public.sep_leituras(grupo,tipo,caixa,isbn,destino,qtd,rotulo,dispositivo) values (v_grupo,'caixa',p_caixa,r.isbn,'E',r.estoque,'Caixa '||p_caixa||' (fechada)',p_dispositivo);
    else
      insert into public.sep_leituras(grupo,tipo,caixa,isbn,destino,qtd,rotulo,dispositivo) values (v_grupo,'caixa',p_caixa,r.isbn,'D',r.estoque,'Caixa '||p_caixa||' (fechada)',p_dispositivo);
    end if;
    v_q := v_q + r.estoque;
  end loop;
  return jsonb_build_object('status','ok','situacao',v_cx.situacao,'grupo',v_grupo,'qtd',v_q);
end $$;

create or replace function public.sep_bipar_item(p_caixa text, p_isbn text, p_dispositivo text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_it public.sep_itens; v_lido jsonb; c int; k int; e int; d int; v_dest text; v_n int; v_prev int;
        v_grupo uuid := gen_random_uuid(); v_tot int; v_lid_cx int;
begin
  if not public.sep_autorizado() then raise exception 'NAO_AUTORIZADO'; end if;
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
    values (v_grupo,'item',p_caixa,p_isbn,v_dest,1,v_it.descricao||' (cx '||p_caixa||')',p_dispositivo);
  select sum(estoque) into v_tot from public.sep_itens where caixa = p_caixa;
  select coalesce(sum(qtd),0) into v_lid_cx from public.sep_leituras where caixa = p_caixa and tipo='item' and destino <> 'X' and not revertida;
  return jsonb_build_object('status','ok','destino',v_dest,'n',v_n,'previsto',v_prev,'grupo',v_grupo,
    'faltam_titulo', greatest(0, v_it.estoque - (c+k+e+d) - case when v_dest='X' then 0 else 1 end),
    'lido_caixa', v_lid_cx, 'total_caixa', v_tot, 'descricao', v_it.descricao);
end $$;

create or replace function public.sep_bipar_solto(p_isbn text, p_prioridade text default 'CBP', p_dispositivo text default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_ped_c int; v_ped_e int; v_sob_c int; v_sob_e int; v_got_c int; v_got_e int; v_need_c int; v_need_e int;
        v_dest text; v_grupo uuid := gen_random_uuid(); v_tit text;
begin
  if not public.sep_autorizado() then raise exception 'NAO_AUTORIZADO'; end if;
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
    values (v_grupo,'solto',p_isbn,v_dest,1,coalesce(v_tit,p_isbn)||' (solto)',p_dispositivo);
  if v_dest='C' then v_got_c := v_got_c + 1; elsif v_dest='E' then v_got_e := v_got_e + 1; end if;
  return jsonb_build_object('status','ok','destino',v_dest,'grupo',v_grupo,'titulo',v_tit,
    'no_pedido', (v_ped_c + v_ped_e) > 0,
    'cbp', jsonb_build_object('pedido',v_ped_c,'sobra',v_sob_c,'soltos',v_got_c,'precisa',v_need_c),
    'cbtbe', jsonb_build_object('pedido',v_ped_e,'sobra',v_sob_e,'soltos',v_got_e,'precisa',v_need_e));
end $$;

create or replace function public.sep_reverter(p_grupo uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_n int; v_q int;
begin
  if not public.sep_autorizado() then raise exception 'NAO_AUTORIZADO'; end if;
  update public.sep_leituras set revertida = true, revertida_em = now()
   where grupo = p_grupo and not revertida;
  get diagnostics v_n = row_count;
  select coalesce(sum(qtd),0) into v_q from public.sep_leituras where grupo = p_grupo;
  return jsonb_build_object('status', case when v_n > 0 then 'ok' else 'ja_revertida' end, 'qtd', v_q);
end $$;

revoke all on function public.sep_ler_caixa(text,text), public.sep_bipar_item(text,text,text),
  public.sep_bipar_solto(text,text,text), public.sep_reverter(uuid) from public, anon;
grant execute on function public.sep_ler_caixa(text,text), public.sep_bipar_item(text,text,text),
  public.sep_bipar_solto(text,text,text), public.sep_reverter(uuid) to authenticated;
