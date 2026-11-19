#!/usr/bin/env node
/**
 * CONTAGEM DE FOTOS POR IMÓVEL, LIDA DIRETO DO DUMP DO KSI.
 *
 * O import do BI (`import-ksi-fast.js`) NÃO traz a tabela `fotos` — o BI nunca
 * precisou dela. Mas os portais do Grupo OLX (Canal Pro) ranqueiam por número
 * de fotos (mínimo 5 em casa, 10 em terreno), então a contagem virou métrica
 * comercial em 19/11/2026.
 *
 * A tabela no Kurole:
 *   fotos(id, id_usuario, id_imovel, ordem, foto, descricao, disponivel,
 *         data, ip, site, migracao_loc_vend, flag_cdn_id, flag_cdn_migrado,
 *         flag_cdn_falha, tamanho)
 *
 * `tamanho` é o peso do arquivo em bytes — o único proxy de QUALIDADE que
 * existe na base. Foto de portal abaixo de ~50 KB costuma ser imagem pequena
 * ou recomprimida; não substitui olhar, mas separa o joio na hora de priorizar.
 *
 * O dump é **latin1** (ver o CHARSET no CREATE TABLE). Aqui só lemos números,
 * mas o stream é decodificado como latin1 assim mesmo para não quebrar tuplas
 * cujo texto tenha acento — ver [[import_coluna_congelada]] e o conserto de
 * encoding do import.
 *
 * Para não varrer os 6 GB inteiros, o script PARA assim que a tabela `fotos`
 * termina (o `UNLOCK TABLES` seguinte).
 *
 * Uso: node scripts/fotos-do-dump.js <dump.sql.gz> [saida.json]
 * Saída: { "<id_imovel>": { n, bytes, menor, maior } }
 */
const fs = require("fs");
const zlib = require("zlib");

const [, , DUMP, SAIDA = "fotos-por-imovel.json"] = process.argv;
if (!DUMP || !fs.existsSync(DUMP)) {
  console.error("uso: node scripts/fotos-do-dump.js <dump.sql.gz> [saida.json]");
  process.exit(1);
}

/**
 * Lê UMA tupla do VALUES a partir de `i` (que aponta para o "(").
 * Precisa ser um scanner de verdade, e não um regex: `descricao` é longtext e
 * pode conter vírgula, parêntese e aspas escapadas — um split quebraria a
 * contagem em silêncio, que é o pior defeito possível aqui.
 * Devolve [campos, próximoÍndice] ou null se a tupla estiver incompleta.
 */
function leTupla(s, i) {
  if (s[i] !== "(") return null;
  const campos = [];
  let atual = "";
  let emAspas = false;
  i++;
  for (; i < s.length; i++) {
    const c = s[i];
    if (emAspas) {
      if (c === "\\") { atual += c + (s[i + 1] ?? ""); i++; continue; }
      if (c === "'") { emAspas = false; continue; }
      atual += c;
    } else if (c === "'") {
      emAspas = true;
    } else if (c === ",") {
      campos.push(atual); atual = "";
    } else if (c === ")") {
      campos.push(atual);
      return [campos, i + 1];
    } else {
      atual += c;
    }
  }
  return null; // tupla cortada no fim do pedaço: devolver para o próximo chunk
}

const porImovel = new Map();
let dentro = false;      // já passamos pelo INSERT INTO `fotos`
let terminou = false;
let resto = "";
let linhas = 0;

const stream = fs.createReadStream(DUMP).pipe(zlib.createGunzip());
stream.setEncoding("latin1");

stream.on("data", (pedaco) => {
  if (terminou) return;
  let s = resto + pedaco;

  while (true) {
    if (!dentro) {
      const p = s.indexOf("INSERT INTO `fotos` VALUES ");
      if (p === -1) {
        // guarda uma cauda, caso o marcador caia na emenda entre dois pedaços
        resto = s.slice(-64);
        return;
      }
      s = s.slice(p + "INSERT INTO `fotos` VALUES ".length);
      dentro = true;
    }

    let i = 0;
    while (i < s.length) {
      if (s[i] === "(") {
        const r = leTupla(s, i);
        if (!r) { resto = s.slice(i); return; }   // incompleta: espera mais dado
        const [c, prox] = r;
        const id = Number(c[2]);                   // id_imovel
        const tam = Number(c[14]) || 0;            // tamanho em bytes
        if (id) {
          let a = porImovel.get(id);
          if (!a) { a = { n: 0, bytes: 0, menor: Infinity, maior: 0 }; porImovel.set(id, a); }
          a.n++; a.bytes += tam;
          if (tam && tam < a.menor) a.menor = tam;
          if (tam > a.maior) a.maior = tam;
        }
        linhas++;
        if (linhas % 200000 === 0) process.stderr.write(`  ${linhas.toLocaleString("pt-BR")} fotos...\n`);
        i = prox;
      } else if (s[i] === ";") {
        // fim deste INSERT; pode vir outro logo adiante
        dentro = false;
        s = s.slice(i + 1);
        if (s.includes("UNLOCK TABLES")) { terminou = true; stream.destroy(); return; }
        break;
      } else {
        i++;
      }
    }
    if (dentro) { resto = s.slice(i); return; }
    if (!s.includes("INSERT INTO `fotos` VALUES ")) { resto = s.slice(-64); return; }
  }
});

function fim() {
  /*
   * `_dump` carrega a procedência junto com o dado. A contagem de fotos sai de
   * um dump que pode ser semanas mais velho que o banco, e quem lê o número
   * precisa saber disso sem ter que perguntar. Chave com "_" não colide com os
   * ids, que são numéricos.
   */
  const saida = { _dump: { arquivo: require("path").basename(DUMP), data: fs.statSync(DUMP).mtime.toISOString() } };
  for (const [id, a] of porImovel) {
    saida[id] = { n: a.n, bytes: a.bytes, menor: a.menor === Infinity ? 0 : a.menor, maior: a.maior };
  }
  fs.writeFileSync(SAIDA, JSON.stringify(saida), "utf-8");
  console.log(`${linhas.toLocaleString("pt-BR")} fotos em ${porImovel.size.toLocaleString("pt-BR")} imóveis -> ${SAIDA}`);
}
stream.on("close", fim);
stream.on("end", fim);
stream.on("error", (e) => { if (!terminou) { console.error("ERRO:", e.message); process.exit(1); } });
