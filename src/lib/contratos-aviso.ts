import { getDb } from "./db";
import { nomeFase } from "./contratos";
import { enviarEmailContrato } from "./mailer";

interface ContratoAviso {
  id: number;
  ref: string;
  tipo: string;
  unidade: string;
  corretor_nome: string | null;
  imovel_endereco: string | null;
}

/**
 * Avisa por e-mail o gerente da unidade/vertical do contrato.
 *
 * Só nas fases em que a bola está com ele ou o assunto acabou (pendência,
 * conferência, finalizado) — decisão do Jonatan em 25/09/2026. Avisar as sete
 * fases viraria sete e-mails por contrato, e e-mail demais é e-mail ignorado.
 *
 * Diretoria e Lançamento não têm gerente próprio no `usuarios_bi`: nesse caso
 * não há quem avisar, e o card segue só no quadro. É registrado no log em vez
 * de estourar — o movimento da fase não pode depender disso.
 */
export async function avisarGerenteDoContrato(
  contrato: ContratoAviso,
  fase: number,
  quem: string,
  comentario: string | null
): Promise<void> {
  const sql = getDb();
  const destinos = (await sql`
    SELECT email, nome FROM usuarios_bi
    WHERE ativo = true AND role = 'gerente'
      AND unidade = ${contrato.unidade} AND tipo = ${contrato.tipo}
  `) as { email: string; nome: string }[];

  if (!destinos.length) {
    console.warn(`contrato ${contrato.id}: sem gerente para ${contrato.unidade}/${contrato.tipo}`);
    return;
  }

  for (const d of destinos) {
    await enviarEmailContrato(d.email, d.nome, {
      ref: contrato.ref,
      fase: nomeFase(fase),
      endereco: contrato.imovel_endereco,
      corretor: contrato.corretor_nome,
      tipo: contrato.tipo === "venda" ? "Venda" : "Locação",
      quem,
      comentario,
      link: `${process.env.BI_URL || "https://bi.imobiliariamaciel.com.br"}/contratos?card=${contrato.id}`,
    });
  }
}
