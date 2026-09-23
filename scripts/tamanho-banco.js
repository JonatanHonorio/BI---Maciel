// Quanto o banco está ocupando, e se já é hora de migrar a Neon.
//
// Existe porque o projeto está no plano **Free da Neon, teto de 512 MB**, e
// isso já parou a operação uma vez: em 14/09/2026 o banco chegou a 490 MB e a
// importação do KSI falhou 328 mil vezes, levando 53 min em vez de 5.
//
// O Jonatan decidiu em 23/09/2026 migrar para o Launch, mas só depois de dois
// meses de uso intenso (~23/11/2026). Este script é o que torna essa espera
// segura: roda na rotina diária e avisa antes do teto chegar.
//
// ⚠️ O número que a Neon COBRA é maior que o que o Postgres reporta — 373 MB
// no console contra 333 MB aqui, em 23/09. Por isso a conta abaixo soma a
// diferença medida. O número exato só o console mostra.
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TETO_FREE = 512;
const ALERTA = 450;       // 88% — migrar na hora em vez de esperar o prazo
const OVERHEAD_NEON = 40; // medido em 23/09/2026 (console 373 × banco 333)

(async () => {
  const { rows: [r] } = await pool.query(`SELECT pg_database_size(current_database())::float b`);
  const banco = r.b / 1048576;
  const cobrado = banco + OVERHEAD_NEON;
  const pct = (cobrado / TETO_FREE) * 100;

  console.log(`Banco: ${banco.toFixed(0)} MB · estimativa do que a Neon cobra: ${cobrado.toFixed(0)} MB de ${TETO_FREE} (${pct.toFixed(0)}%)`);

  if (cobrado >= ALERTA) {
    console.log(`\n🚨 PASSOU DE ${ALERTA} MB — avisar o Jonatan. A hora de migrar pro Launch é agora,`);
    console.log(`   sem esperar o prazo de novembro. Em 490 MB a importação do KSI começa a falhar.`);
    console.log(`   console.neon.tech · conta jonatanhonorio@gmail.com · projeto bi-maciel`);
  } else {
    const folga = ALERTA - cobrado;
    console.log(`Folga até o alerta: ${folga.toFixed(0)} MB (~${Math.round(folga / 0.55)} dias no ritmo medido de 0,55 MB/dia).`);
  }
  await pool.end();
})();
