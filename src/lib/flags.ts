/**
 * Chaves de comportamento temporário.
 *
 * Este arquivo não importa nada de propósito. `@/lib/fechamento` puxa
 * `@/lib/unidade`, que usa `fs`/`path`, e por isso não pode ser importado por
 * componente client — o build quebra. Como a mesma chave precisa valer no
 * formulário (client) e na API (server), ela mora aqui, sozinha.
 */

/**
 * Deixa o rateio aceitar um nome DIGITADO quando a pessoa não existe no
 * cadastro do Kurole.
 *
 * Ligada em 21/09/2026 para a carga retroativa dos fechamentos de dez/2025 a
 * ago/2026: aqueles meses têm captadores e vendedores que já saíram da
 * empresa e sumiram do cadastro.
 *
 * DESLIGADA em 30/09/2026, com a carga retroativa terminada (833 negócios,
 * dez/2025 a ago/2026 enviados). Antes de desligar, a auditoria ligou ao
 * cadastro do Kurole todas as linhas com correspondência — ver
 * `scripts/corrigir-digitacao-fechamento.js`.
 *
 * Sobraram 18 linhas em 6 nomes (Doris, Rita, Kely Silva, Helen Firmino, Ana
 * Mosti, Pamela), gente que passou pela empresa e nunca teve cadastro. Elas
 * continuam aparecendo e recebendo comissão: a LEITURA nunca dependeu desta
 * chave, só a digitação de linhas novas.
 *
 * O preenchimento automático pela referência não muda — continua trazendo o
 * captador do Kurole.
 *
 * QUANDO RELIGAR: se um acerto retroativo precisar de alguém que já saiu e
 * sumiu da lista (ela só traz corretor ATIVO). A alternativa, melhor, é
 * reativar a pessoa no Kurole. Trocar para `true` e subir basta.
 */
export const PERMITE_NOME_LIVRE_NO_RATEIO = false;
