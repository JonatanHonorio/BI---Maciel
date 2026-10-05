import { getDb } from "./db";
import { nomeFase } from "./contratos";
import { enviarEmailContrato } from "./mailer";

interface ContratoAviso {
  id: number;
  ref: string;
  /** Número do contrato no Kurole, quando já existe. */
  contrato?: string | null;
  senha: number | null;
  tipo: string;
  unidade: string;
  corretor_nome: string | null;
  imovel_endereco: string | null;
}

const linkDoCard = (id: number) =>
  `${process.env.BI_URL || "https://bi.imobiliariamaciel.com.br"}/contratos?card=${id}`;

/**
 * Avisa o setor de contratos (a Ana) quando QUEM NÃO OPERA o quadro move um
 * card — na prática, o gerente conferindo: aprovando para a assinatura ou
 * devolvendo para pendência.
 *
 * Pedido da Ana em 05/10/2026: "quando o gerente confere e muda de fase, ela
 * precisa ser notificada". Antes o movimento era silencioso — o card mudava de
 * coluna e ela só descobria olhando o quadro.
 *
 * São DOIS canais de propósito, e nesta ordem: a notificação no banco (que
 * vira o sino do BI) é gravada primeiro e não depende de e-mail nenhum; o
 * e-mail vem depois e pode falhar sem levar o aviso junto. Hoje o remetente é
 * um Gmail pessoal e a entrega no domínio da Maciel é filtrada — se o aviso
 * dependesse só dele, a Ana não ficaria sabendo de nada.
 */
export async function avisarContratosDoMovimento(
  contrato: ContratoAviso,
  de: number,
  para: number,
  quem: string,
  comentario: string | null
): Promise<void> {
  const sql = getDb();
  const destinos = (await sql`
    SELECT id, email, nome FROM usuarios_bi
    WHERE ativo = true AND role = 'contratos'
  `) as { id: number; email: string; nome: string }[];

  if (!destinos.length) {
    console.warn("sem ninguém com perfil de contratos para avisar");
    return;
  }

  const titulo = `${quem} moveu o contrato ${contrato.ref} para ${nomeFase(para)}`;
  const texto = [
    `Saiu de ${nomeFase(de)}.`,
    comentario ? `Observação: ${comentario}` : null,
  ].filter(Boolean).join(" ");

  for (const d of destinos) {
    await sql`
      INSERT INTO contrato_notificacoes (contrato_id, usuario_id, titulo, texto)
      VALUES (${contrato.id}, ${d.id}, ${titulo}, ${texto || null})
    `;
  }

  for (const d of destinos) {
    try {
      await enviarEmailContrato(d.email, d.nome, {
        senha: contrato.senha,
        ref: contrato.ref,
        fase: nomeFase(para),
        endereco: contrato.imovel_endereco,
        corretor: contrato.corretor_nome,
        tipo: contrato.tipo === "venda" ? "Venda" : "Locação",
        quem,
        comentario,
        link: linkDoCard(contrato.id),
      });
    } catch (e) {
      console.error("e-mail para o setor de contratos não enviado:", (e as Error).message);
    }
  }
}

/**
 * Avisa por e-mail o gerente da unidade/vertical do contrato.
 *
 * Só nas fases em que a bola está com ele ou o assunto acabou (pendência,
 * conferência, finalizado) — decisão do Jonatan em 25/09/2026. Avisar as sete
 * fases viraria sete e-mails por contrato, e e-mail demais é e-mail ignorado.
 *
 * Diretoria e Lançamento não têm gerente próprio no `usuarios_bi`. Nesses
 * casos o aviso sobe para quem dirige a vertical — a Daniela em vendas, por
 * decisão do Jonatan em 25/09/2026 ("Daniela será a gerente das vendas da
 * diretoria"). Ela continua com `unidade` nula no cadastro, que é o que lhe dá
 * a visão de todas as unidades; trocar isso por "Diretoria" resolveria o
 * e-mail e quebraria a visão dela.
 *
 * Locação não tem diretora equivalente, então contrato de locação numa unidade
 * sem gerente segue sem aviso — fica no log em vez de estourar, porque o
 * movimento da fase não pode depender do e-mail.
 */
export async function avisarGerenteDoContrato(
  contrato: ContratoAviso,
  fase: number,
  quem: string,
  comentario: string | null
): Promise<void> {
  const sql = getDb();
  let destinos = (await sql`
    SELECT email, nome FROM usuarios_bi
    WHERE ativo = true AND role = 'gerente'
      AND unidade = ${contrato.unidade} AND tipo = ${contrato.tipo}
  `) as { email: string; nome: string }[];

  // Sem gerente próprio: cai na direção da vertical (unidade nula).
  if (!destinos.length) {
    destinos = (await sql`
      SELECT email, nome FROM usuarios_bi
      WHERE ativo = true AND role = 'gerente'
        AND unidade IS NULL AND tipo = ${contrato.tipo}
    `) as { email: string; nome: string }[];
  }

  if (!destinos.length) {
    console.warn(`contrato ${contrato.id}: sem gerente para ${contrato.unidade}/${contrato.tipo}`);
    return;
  }

  for (const d of destinos) {
    await enviarEmailContrato(d.email, d.nome, {
      // A senha vai junto porque é por ela que o gerente acompanha a fila —
      // a referência identifica o imóvel, a senha diz a vez.
      senha: contrato.senha,
      ref: contrato.ref,
      fase: nomeFase(fase),
      endereco: contrato.imovel_endereco,
      corretor: contrato.corretor_nome,
      tipo: contrato.tipo === "venda" ? "Venda" : "Locação",
      quem,
      comentario,
      link: linkDoCard(contrato.id),
    });
  }
}
