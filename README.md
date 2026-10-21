# Separação da sobra · CBP, CBTBE e Devolução

Sistema web para separar a sobra do Artmed Experience entre os pedidos do **CBP**, do **CBTBE** e a **devolução** ao estoque.
Tela única: lê caixa (nota + número) ou bipa o título (ISBN), mostra o destino de cada leitura, permite reverter
e tem os contadores dos três pedidos (lido / previsto), com a lista de títulos que faltam.

- **Página:** GitHub Pages (este repositório)
- **Banco:** Supabase, projeto *Controle de eventos*, tabelas com prefixo `sep_`
- **Plano de separação:** `dados/plano.json` (gerado da planilha `dados/Cruzamento_Sobra_EX_x_CBP_CBTBE_v4.xlsx`)

## Estrutura

| Caminho | O que é |
|---|---|
| `index.html`, `app.js` | A página |
| `config.js` | URL do Supabase e chave publicável |
| `dados/plano.json` | Plano de separação (caixas, itens, pedidos) carregado no banco pela própria página |
| `dados/*.xlsx` | Planilha de origem do plano |
| `scripts/gerar_plano_json.py` | Gera `dados/plano.json` a partir da planilha |
| `supabase/migrations/` | Estrutura do banco (tabelas, segurança e funções), já aplicada no projeto |

## Primeira configuração (uma vez)

1. **Definir a senha da equipe no Supabase**
   O login da separação é próprio: **não** cria usuário no Controle de eventos nem no Supabase Auth.
   Painel do Supabase → projeto *Controle de eventos* → **SQL Editor** → rode (troque pela senha da equipe):
   ```sql
   select public.sep_definir_senha('a-senha-da-equipe');
   ```
   A senha fica guardada criptografada na tabela `sep_config`. Para trocar, rode o mesmo comando com a senha nova
   (quem estiver conectado precisa entrar de novo).

2. **Publicar no GitHub Pages**
   Envie este repositório para o GitHub → Settings → Pages → *Deploy from a branch* → branch `main`, pasta `/ (root)`.
   O endereço fica `https://<usuario>.github.io/<repositorio>/`.

3. **Carregar o plano no banco**
   Abra a página, entre com a senha da equipe e seu nome e clique em **Carregar plano**.

## Atualizar o plano

1. Atualize a planilha e salve no Excel (os valores calculados precisam estar gravados).
2. `pip install openpyxl` e `python scripts/gerar_plano_json.py dados/<planilha>.xlsx v5-AAAA-MM-DD`
3. Commit e push de `dados/plano.json` (e da planilha).
4. Na página aparece o aviso de plano novo → **Carregar plano novo**.
   Se já houver leituras, a página pede confirmação, porque trocar o plano **reverte todas as leituras**.

## Como o sistema decide o destino

- **Caixa fechada** (Inteira CBP, Inteira CBTBE ou Devolução fechada): uma leitura registra a caixa inteira. Ler de novo não conta duas vezes.
- **Caixa aberta / avulsos:** a caixa fica ativa e cada bipe vai, nesta ordem, para CBP → complemento do CBP → CBTBE → devolução, conforme o plano daquele título na caixa. Passou do previsto: devolução (excedente).
- **Livro solto** (sem caixa ativa): vai para o pedido que ainda precisa do título (pedido menos o que vem da sobra), na prioridade escolhida em *Ajustes*. Pedidos completos ou título fora dos pedidos: devolução.
- A decisão é feita no banco (funções `sep_*`), com trava por caixa/título, então várias pessoas podem bipar ao mesmo tempo.

## Segurança

- A chave em `config.js` é a **publicável** do Supabase; pode ficar pública.
- As tabelas `sep_*` não podem ser lidas nem alteradas diretamente pela internet. A página só usa funções
  (`sep_login`, `sep_plano`, `sep_estado`, `sep_ler_caixa`, `sep_bipar_item`, `sep_bipar_solto`, `sep_reverter`,
  `sep_carregar_plano`) que exigem o token de uma sessão aberta com a senha da equipe.
- Sessões duram 30 dias. Após 20 senhas erradas em 15 minutos, o login fica bloqueado por 15 minutos.
- `sep_definir_senha` só pode ser executada pelo SQL Editor do Supabase.
