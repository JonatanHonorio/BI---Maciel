// Cria as tabelas do Kanban do setor de contratos (25/09/2026).
// Idempotente (CREATE TABLE / ADD COLUMN IF NOT EXISTS) — seguro rodar de novo.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  /*
   * Um card = um contrato em andamento. `fase` é o número da coluna do quadro
   * (1..7, ver FASES em src/lib/contratos.ts) — número em vez de texto porque
   * as fases têm ORDEM e a regra de quem pode mover depende de comparar duas
   * delas ("o gerente só devolve para trás até a pendência").
   *
   * Vendedor e comprador são JSONB e não tabelas próprias: um contrato pode ter
   * vários de cada (imóvel de casal, compra em nome de duas pessoas), os campos
   * mudam entre venda e locação, e nada aqui é consultado por pessoa — o quadro
   * filtra por unidade, tipo e fase, nunca por CPF do comprador.
   *
   * `banco` fica numa coluna à parte do resto de propósito: é o único dado do
   * card que gerente nenhum enxerga (decisão do Jonatan em 25/09), e separá-lo
   * deixa a API omitir a coluna inteira em vez de peneirar campo a campo dentro
   * de um JSON — o que erra calado no dia em que alguém acrescentar um campo.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contratos (
      id SERIAL PRIMARY KEY,
      ref VARCHAR(30) NOT NULL,
      imovel_id INTEGER,
      tipo VARCHAR(10) NOT NULL,
      unidade VARCHAR(60) NOT NULL,
      corretor_id INTEGER,
      corretor_nome TEXT NOT NULL DEFAULT '',
      fase SMALLINT NOT NULL DEFAULT 1,
      vendedor JSONB NOT NULL DEFAULT '[]'::jsonb,
      comprador JSONB NOT NULL DEFAULT '[]'::jsonb,
      imovel_endereco TEXT,
      imovel_dados JSONB NOT NULL DEFAULT '{}'::jsonb,
      banco JSONB NOT NULL DEFAULT '{}'::jsonb,
      pagamento TEXT,
      observacao TEXT,
      arquivado BOOLEAN NOT NULL DEFAULT false,
      criado_em TIMESTAMP DEFAULT NOW(),
      criado_por INTEGER REFERENCES usuarios_bi(id),
      atualizado_em TIMESTAMP DEFAULT NOW(),
      atualizado_por INTEGER REFERENCES usuarios_bi(id)
    )
  `);
  console.log("ok: contratos");

  // O quadro sempre abre filtrando unidade+tipo do gerente e escondendo
  // arquivado — sem este índice vira varredura da tabela a cada abertura.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS contratos_quadro_idx
    ON contratos (unidade, tipo, arquivado)
  `);
  console.log("ok: contratos_quadro_idx");

  /*
   * Histórico do card: toda mudança de fase e todo comentário viram uma linha
   * aqui. É o que responde "por que este contrato está parado há 9 dias" — e
   * `de`/`para` nulos distinguem comentário puro de movimento.
   *
   * `criado_por_nome` é cópia do nome, não join: quem escreveu continua
   * aparecendo no histórico mesmo que a conta saia do BI depois.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS contrato_eventos (
      id SERIAL PRIMARY KEY,
      contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
      de SMALLINT,
      para SMALLINT,
      comentario TEXT,
      criado_em TIMESTAMP DEFAULT NOW(),
      criado_por INTEGER REFERENCES usuarios_bi(id),
      criado_por_nome TEXT NOT NULL DEFAULT ''
    )
  `);
  console.log("ok: contrato_eventos");

  await pool.query(`
    CREATE INDEX IF NOT EXISTS contrato_eventos_contrato_idx
    ON contrato_eventos (contrato_id, id)
  `);
  console.log("ok: contrato_eventos_contrato_idx");

  /*
   * Proprietário do imóvel, vindo do Kurole (clientes_imoveis). É o que permite
   * a Ana digitar a referência e o vendedor vir preenchido, do mesmo jeito que
   * o endereço já vem hoje no fechamento.
   */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS imovel_proprietarios (
      id INTEGER PRIMARY KEY,
      imovel_id INTEGER NOT NULL,
      cliente_id INTEGER NOT NULL,
      percentual NUMERIC(9,4)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS imovel_proprietarios_imovel_idx
    ON imovel_proprietarios (imovel_id)
  `);
  console.log("ok: imovel_proprietarios");

  /*
   * Campos do cliente que o contrato precisa e que a importação não trazia —
   * o BI só guardava nome/contato/cidade, porque até agora ninguém precisava
   * de dado de contrato aqui dentro.
   *
   * Dado pessoal de verdade (CPF, RG, conta bancária). Só a rota de contratos
   * lê estas colunas, e só para quem pode ver o card.
   */
  const novas = [
    "cpf VARCHAR(20)", "rg VARCHAR(30)", "rg_emissor VARCHAR(30)",
    "data_nascimento DATE", "nacionalidade VARCHAR(60)", "profissao VARCHAR(120)",
    "estado_civil_id INTEGER", "endereco VARCHAR(255)", "numero VARCHAR(30)",
    "complemento VARCHAR(120)", "cep VARCHAR(20)",
    "banco VARCHAR(120)", "agencia VARCHAR(30)", "conta VARCHAR(40)",
  ];
  for (const c of novas) {
    await pool.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ${c}`);
  }
  console.log(`ok: clientes +${novas.length} colunas`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS estados_civis (
      id INTEGER PRIMARY KEY,
      nome VARCHAR(60) NOT NULL DEFAULT ''
    )
  `);
  console.log("ok: estados_civis");

  await pool.end();
  console.log("\nMigração concluída.");
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
