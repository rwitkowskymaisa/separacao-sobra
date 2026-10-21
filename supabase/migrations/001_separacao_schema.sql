-- Sistema de separação da sobra do Artmed Experience (CBP, CBTBE e Devolução)
-- Todas as tabelas usam o prefixo sep_ para não conflitar com o Controle de eventos.

create table if not exists public.sep_acesso (
  email text primary key
);
comment on table public.sep_acesso is 'E-mails de login autorizados a usar o sistema de separação (login único da equipe).';

create table if not exists public.sep_caixas (
  id text primary key,
  situacao text not null check (situacao in ('Inteira CBP','Inteira CBTBE','Aberta','Devolução fechada','Avulso')),
  convertida boolean not null default false,
  notas int[] not null default '{}'
);

create table if not exists public.sep_itens (
  caixa text not null references public.sep_caixas(id) on delete cascade,
  isbn text not null,
  descricao text not null,
  nota int not null,
  estoque int not null check (estoque >= 0),
  cbp int not null default 0,    -- total que vai ao CBP (inclui complemento)
  comp int not null default 0,   -- parte do cbp que é complemento
  cbtbe int not null default 0,
  dev int not null default 0,
  primary key (caixa, isbn),
  check (cbp + cbtbe + dev = estoque and comp <= cbp)
);
create index if not exists sep_itens_isbn_idx on public.sep_itens(isbn);

create table if not exists public.sep_pedidos (
  isbn text not null,
  evento text not null check (evento in ('CBP','CBTBE')),
  titulo text not null,
  autor text,
  qtd int not null check (qtd >= 0),
  primary key (isbn, evento)
);

create table if not exists public.sep_leituras (
  id bigint generated always as identity primary key,
  grupo uuid not null default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  tipo text not null check (tipo in ('caixa','item','solto')),
  caixa text references public.sep_caixas(id),
  isbn text,
  destino text not null check (destino in ('C','K','E','D','X')),  -- C=CBP, K=CBP complemento, E=CBTBE, D=devolução, X=excedente (devolução)
  qtd int not null check (qtd > 0),
  rotulo text,
  usuario text default (auth.jwt() ->> 'email'),
  dispositivo text,
  revertida boolean not null default false,
  revertida_em timestamptz
);
create index if not exists sep_leituras_grupo_idx on public.sep_leituras(grupo);
create index if not exists sep_leituras_caixa_isbn_idx on public.sep_leituras(caixa, isbn) where not revertida;
create index if not exists sep_leituras_isbn_idx on public.sep_leituras(isbn) where not revertida;
-- uma caixa fechada só pode estar lida uma vez (sem contar leituras revertidas)
create unique index if not exists sep_leituras_caixa_fechada_uk on public.sep_leituras(caixa, isbn, destino) where tipo = 'caixa' and not revertida;

-- quem pode usar
create or replace function public.sep_autorizado()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sep_acesso a where lower(a.email) = lower(coalesce(auth.jwt() ->> 'email','')));
$$;
revoke all on function public.sep_autorizado() from public, anon;
grant execute on function public.sep_autorizado() to authenticated;

alter table public.sep_acesso  enable row level security;
alter table public.sep_caixas  enable row level security;
alter table public.sep_itens   enable row level security;
alter table public.sep_pedidos enable row level security;
alter table public.sep_leituras enable row level security;

create policy sep_caixas_ler  on public.sep_caixas  for select to authenticated using (public.sep_autorizado());
create policy sep_itens_ler   on public.sep_itens   for select to authenticated using (public.sep_autorizado());
create policy sep_pedidos_ler on public.sep_pedidos for select to authenticated using (public.sep_autorizado());
create policy sep_leituras_ler on public.sep_leituras for select to authenticated using (public.sep_autorizado());
create policy sep_leituras_inserir on public.sep_leituras for insert to authenticated with check (public.sep_autorizado());
create policy sep_leituras_reverter on public.sep_leituras for update to authenticated using (public.sep_autorizado()) with check (public.sep_autorizado());
-- sep_acesso fica sem políticas: só a função sep_autorizado() lê.

-- totais lidos (sem revertidas)
create or replace view public.sep_lidos with (security_invoker = true) as
  select tipo, caixa, isbn, destino, sum(qtd)::int as qtd
  from public.sep_leituras where not revertida
  group by tipo, caixa, isbn, destino;

-- tempo real
do $$ begin
  alter publication supabase_realtime add table public.sep_leituras;
exception when duplicate_object then null; end $$;
