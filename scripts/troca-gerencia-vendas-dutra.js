#!/usr/bin/env node
/**
 * TROCA PROGRAMADA PARA 01/12/2026 — NÃO RODAR ANTES.
 *
 * Daniel Santos deixa a gerência de vendas da Dutra e volta a ser CORRETOR de
 * vendas da unidade; Emanoel Anderson Duarte Montenegro ("Anderson", corretor
 * #1100 no Kurole) assume. O Jonatan avisou em 16/11/2026 que a posse é **no
 * dia 1º**, não imediata: a troca chegou a ser aplicada nesse dia e foi
 * revertida no mesmo dia. Até lá o gerente de vendas da Dutra é o Daniel.
 *
 * Por que a data importa e não é detalhe de agenda: o gerente da unidade é
 * quem o fechamento põe sozinho no bloco Gerência (`gerenteDaUnidade`). Rodar
 * antes do dia 1º faria novembro — mês que ainda está aberto — nascer com o
 * nome do Anderson na gerência de negócios que foram tocados pelo Daniel.
 *
 *   node scripts/troca-gerencia-vendas-dutra.js --aplicar     # 01/12: faz a troca
 *   node scripts/troca-gerencia-vendas-dutra.js --reverter --aplicar
 *
 * Sem `--aplicar` os dois sentidos só simulam. Idempotente nos dois sentidos,
 * e ele RECUSA aplicar antes de 01/12/2026 a menos que venha `--mesmo-assim`.
 *
 * O que a troca faz no BI:
 *  - ativa (ou cria) o login do Anderson como gerente de vendas da Dutra,
 *    copiando o perfil de outro gerente de vendas em vez de digitar campos;
 *  - DESATIVA o login do Daniel. Não é desligamento: ele continua na Maciel,
 *    mas corretor não tem acesso ao BI — não existe perfil para quem atende.
 *    Deixar o login de pé lhe daria a unidade inteira e poria dois candidatos
 *    no mesmo LIMIT 1 de `gerenteDaUnidade`.
 *
 * O que ele NÃO faz, de propósito:
 *  - não mexe em rateio nenhum: a gerência dos negócios que o Daniel fechou
 *    como gerente continua dele, inclusive em novembro;
 *  - não tira o Daniel de `corretores_fechamento.json`: ele passa a aparecer
 *    nos blocos de levantamento/fechamento, que é o que um corretor faz.
 *
 * ⚠️ O e-mail do Anderson no Kurole já é `manoel.guttierrez@...` (corretor
 * #1100), então `gerenteDaUnidade` acha o cadastro dele na hora. O que falta
 * lá é só o DEPARTAMENTO dos dois, hoje trocado (#138 em "Gerente Vendas
 * Dutra", #1100 em "Vendas Dutra"). Não quebra nada — os dois departamentos
 * caem na mesma unidade e vertical —, mas deixa o organograma mentindo.
 *
 * ⚠️ Existe OUTRO Anderson ativo em Vendas Dutra: Anderson Campos (#314).
 * O gerente é o #1100, pelo e-mail. Nunca casar por "Anderson".
 *
 * Depois de aplicar no dia 1º: gerar o link de senha dele, que vale 1 hora —
 *   node scripts/link-definir-senha.js manoel.guttierrez@imobiliariamaciel.com.br --aplicar
 */
require("dotenv").config({ path: ".env.local", quiet: true });
const { Pool } = require("pg");

const EMAIL_DANIEL = "daniel.santos@imobiliariamaciel.com.br";
const EMAIL_ANDERSON = "manoel.guttierrez@imobiliariamaciel.com.br";
const NOME_ANDERSON = "Anderson Montenegro";
const MODELO = "eder.ribeiro@imobiliariamaciel.com.br"; // gerente de vendas
const UNIDADE = "Dutra";
const POSSE = "2026-12-01";

const APLICAR = process.argv.includes("--aplicar");
const REVERTER = process.argv.includes("--reverter");
const MESMO_ASSIM = process.argv.includes("--mesmo-assim");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, keepAlive: true });
const q = async (s, p) => {
  for (let i = 0; i < 6; i++) {
    try { return await pool.query(s, p); }
    catch (e) { if (i === 5) throw e; await new Promise(r => setTimeout(r, 2000)); }
  }
};
const hoje = () => new Date().toISOString().slice(0, 10);

/** Liga ou desliga um login que já existe. Devolve o que achou. */
async function mexer(email, ativo) {
  const [u] = (await q(
    `SELECT id, nome, role, unidade, tipo, ativo FROM usuarios_bi WHERE lower(email)=$1`, [email]
  )).rows;
  if (!u) return null;
  const rotulo = `#${u.id} ${u.nome} · ${u.role} · ${u.unidade}/${u.tipo} · ativo=${u.ativo}`;
  if (u.ativo === ativo) { console.log(`  ${rotulo} — já está como deveria`); return u; }
  if (!APLICAR) { console.log(`  ${rotulo} — (simulação) passaria para ativo=${ativo}`); return u; }
  // O token de definir senha morre junto com o acesso: link vivo de conta
  // desativada é porta sem dono.
  await q(
    `UPDATE usuarios_bi SET ativo = $2,
            reset_token_hash = CASE WHEN $2 THEN reset_token_hash ELSE NULL END,
            reset_token_expires = CASE WHEN $2 THEN reset_token_expires ELSE NULL END
     WHERE id = $1`, [u.id, ativo]);
  console.log(`  ${rotulo} -> ativo=${ativo}`);
  return u;
}

(async () => {
  const sentido = REVERTER ? "REVERTER (Daniel volta a gerente)" : "APLICAR (Anderson assume)";
  console.log(`sentido: ${sentido} · hoje ${hoje()} · posse ${POSSE}\n`);

  if (!REVERTER && APLICAR && hoje() < POSSE && !MESMO_ASSIM) {
    throw new Error(
      `a posse do Anderson é ${POSSE} e hoje é ${hoje()}. Aplicar agora poria o nome ` +
      `dele na gerência de novembro, que ainda está aberto. Se for pra valer mesmo ` +
      `assim, repita com --mesmo-assim.`);
  }

  if (REVERTER) {
    console.log("Daniel (volta a gerente):");
    const d = await mexer(EMAIL_DANIEL, true);
    if (!d) throw new Error("login do Daniel não encontrado");
    console.log("Anderson (sai):");
    const a = await mexer(EMAIL_ANDERSON, false);
    if (!a) console.log("  ainda não tem login — nada a desativar");
  } else {
    console.log("Anderson (assume):");
    const a = await mexer(EMAIL_ANDERSON, true);
    if (!a) {
      const [m] = (await q(
        `SELECT role, tipo, marketing, ranking, contratos FROM usuarios_bi WHERE lower(email)=$1`, [MODELO]
      )).rows;
      if (!m) throw new Error(`modelo ${MODELO} não encontrado`);
      if (m.role !== "gerente" || m.tipo !== "venda") {
        throw new Error(`o modelo deixou de ser gerente de vendas (hoje ${m.role}/${m.tipo}) — conferir antes`);
      }
      console.log(`  criaria: ${NOME_ANDERSON} · ${EMAIL_ANDERSON} · ${m.role} · ${UNIDADE}/${m.tipo}`);
      if (APLICAR) {
        const [novo] = (await q(
          `INSERT INTO usuarios_bi (email, nome, role, unidade, tipo, marketing, ranking, contratos, ativo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
           RETURNING id, nome, role, unidade, tipo, ativo`,
          [EMAIL_ANDERSON, NOME_ANDERSON, m.role, UNIDADE, m.tipo,
           m.marketing === true, m.ranking === true, m.contratos === true]
        )).rows;
        console.log(`  criado: #${novo.id} · ${novo.role} · ${novo.unidade}/${novo.tipo} · ativo=${novo.ativo}`);
      }
    }
    console.log("Daniel (volta a corretor):");
    const d = await mexer(EMAIL_DANIEL, false);
    if (!d) throw new Error("login do Daniel não encontrado");
  }

  // ---------- conferência: quem o fechamento vai pôr na gerência ----------
  const { rows: g } = await q(
    `SELECT u.nome, u.email,
            (SELECT count(*)::int FROM corretores c WHERE lower(c.email)=lower(u.email)) AS elo
     FROM usuarios_bi u
     WHERE u.role='gerente' AND u.tipo='venda' AND u.unidade='Dutra' AND u.ativo=true`
  );
  console.log(`\ngerente de vendas da Dutra com login ativo: ${
    g.length ? g.map(r => `${r.nome} (vínculo Kurole: ${r.elo ? "OK" : "NÃO ENCONTRADO"})`).join(", ")
             : "NENHUM — o bloco Gerência sairia vazio"}`);
  if (g.length > 1) console.log("⚠️ mais de um: gerenteDaUnidade pega só o primeiro, arrumar");

  if (!APLICAR) console.log("\n(simulação — rode com --aplicar)");
  else if (!REVERTER) console.log(`\npróximo passo: node scripts/link-definir-senha.js ${EMAIL_ANDERSON} --aplicar`);
  await pool.end();
})().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
