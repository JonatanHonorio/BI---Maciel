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
 * O preenchimento automático pela referência NÃO muda — continua trazendo o
 * captador do Kurole. Digitar é só a saída para quem o Kurole não conhece.
 *
 * COMO DESLIGAR, quando a carga terminar: trocar para `false`. A tela volta a
 * exigir nome da lista, e as linhas já gravadas com nome digitado continuam
 * aparecendo normalmente (a leitura não depende desta chave).
 */
export const PERMITE_NOME_LIVRE_NO_RATEIO = true;
