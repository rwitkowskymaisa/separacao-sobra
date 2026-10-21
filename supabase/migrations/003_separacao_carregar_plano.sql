-- leituras guardam o nº da caixa como texto (histórico sobrevive à troca de plano)
alter table public.sep_leituras drop constraint if exists sep_leituras_caixa_fkey;

-- Carrega (ou troca) o plano de separação a partir do arquivo dados/plano.json do repositório.
create table if not exists public.sep_plano_info (
  id int primary key default 1 check (id = 1),
  versao text not null,
  carregado_em timestamptz not null default now(),
  carregado_por text
);
alter table public.sep_plano_info enable row level security;
create policy sep_plano_info_ler on public.sep_plano_info for select to authenticated using (public.sep_autorizado());

create or replace function public.sep_carregar_plano(p jsonb, p_forcar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lidas int; v_cx int; v_it int; v_pd int;
begin
  if not public.sep_autorizado() then raise exception 'NAO_AUTORIZADO'; end if;
  if p ? 'versao' is false or p ? 't' is false or p ? 'b' is false or p ? 'p' is false then raise exception 'PLANO_INVALIDO'; end if;
  select count(*) into v_lidas from public.sep_leituras where not revertida;
  if v_lidas > 0 and not p_forcar then
    return jsonb_build_object('status','tem_leituras','leituras',v_lidas);
  end if;
  perform pg_advisory_xact_lock(hashtext('sep:plano'));
  if v_lidas > 0 then
    update public.sep_leituras set revertida = true, revertida_em = now() where not revertida;
  end if;
  delete from public.sep_itens; delete from public.sep_caixas; delete from public.sep_pedidos;
  create temporary table _t on commit drop as
    select (e.ord-1)::int ix, e.v->>0 isbn, e.v->>1 descr, nullif(e.v->>2,'') tit
    from jsonb_array_elements(p->'t') with ordinality e(v,ord);
  insert into public.sep_caixas(id,situacao,convertida,notas)
    select b->>0, b->>1, (b->>2)::int=1, array(select jsonb_array_elements_text(b->3)::int)
    from jsonb_array_elements(p->'b') b;
  get diagnostics v_cx = row_count;
  insert into public.sep_itens(caixa,isbn,descricao,nota,estoque,cbp,comp,cbtbe,dev)
    select b->>0, t.isbn, t.descr, (r->>1)::int,(r->>2)::int,(r->>3)::int,(r->>4)::int,(r->>5)::int,(r->>6)::int
    from jsonb_array_elements(p->'b') b, jsonb_array_elements(b->4) r join _t t on t.ix=(r->>0)::int;
  get diagnostics v_it = row_count;
  insert into public.sep_pedidos(isbn,evento,titulo,autor,qtd)
    select t.isbn, x->>1, coalesce(t.tit,t.descr), x->>3, (x->>2)::int
    from jsonb_array_elements(p->'p') x join _t t on t.ix=(x->>0)::int;
  get diagnostics v_pd = row_count;
  insert into public.sep_plano_info(id,versao,carregado_em,carregado_por) values (1,p->>'versao',now(),auth.jwt()->>'email')
    on conflict (id) do update set versao = excluded.versao, carregado_em = excluded.carregado_em, carregado_por = excluded.carregado_por;
  return jsonb_build_object('status','ok','caixas',v_cx,'itens',v_it,'pedidos',v_pd,'versao',p->>'versao');
end $$;
revoke all on function public.sep_carregar_plano(jsonb,boolean) from public, anon;
grant execute on function public.sep_carregar_plano(jsonb,boolean) to authenticated;
