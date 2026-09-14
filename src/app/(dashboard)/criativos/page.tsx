"use client";
import { useState } from "react";
import { useDateRange, useFetch } from "@/lib/hooks";
import DateFilter from "@/components/DateFilter";
import s from "./criativos.module.css";

interface Criativo {
  nome: string;
  produto: string;
  campanha: string;
  tipo: "lead" | "conv";
  thumbnail_url: string | null;
  preview_url: string | null;
  gasto: number;
  resultados: number;
  custo_por_resultado: number | null;
  ctr: number;
}

interface CData {
  periodo: { since: string; until: string };
  min_gasto: number;
  total_gasto: number;
  total_resultados: number;
  total_criativos: number;
  ranking: Criativo[];
  sem_volume: Criativo[];
}

const PRODUTOS = ["Casa do Cristian", "Vila Amélia", "Quadria"];

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl0 = (n: number) =>
  n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const dataBR = (d: string) => d.split("-").reverse().join("/");

function tier(cpr: number) {
  if (cpr <= 7) return s.tierBom;
  if (cpr <= 20) return s.tierMedio;
  return s.tierCaro;
}

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  const [erro, setErro] = useState(false);
  if (!src || erro) return <div className={s.thumbEmpty} aria-hidden="true" />;
  // Imagens vem do CDN da Meta e trocam de URL a cada sync — <img> simples
  // evita depender de remotePatterns do next/image.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={s.thumb} src={src} alt={alt} loading="lazy" onError={() => setErro(true)} />;
}

export default function CriativosPage() {
  const { since, until, setSince, setUntil, setPreset } = useDateRange();
  const { data, loading, error } = useFetch<CData>(
    `/api/criativos?since=${since}&until=${until}`
  );
  const [filtro, setFiltro] = useState<string>("todos");

  const visivel = (c: Criativo) => filtro === "todos" || c.produto === filtro;

  const ranking = (data?.ranking ?? []).filter(visivel);
  const semVolume = (data?.sem_volume ?? []).filter(visivel);
  const maxCpr = Math.max(1, ...ranking.map((c) => c.custo_por_resultado ?? 0));
  const melhor = ranking[0];

  return (
    <div className={s.page}>
      <header className={s.top}>
        <p className={s.eyebrow}>
          Imobiliária Maciel · Meta Ads ·{" "}
          {data ? `${dataBR(data.periodo.since)} a ${dataBR(data.periodo.until)}` : "carregando"}
        </p>
        <h1 className={s.title}>
          Quais criativos <em>realmente</em> trazem cliente
        </h1>
        <p className={s.dek}>
          Anúncios de Casa do Cristian, Vila Amélia e Quadria, ordenados pelo custo por
          resultado. Clique em <strong>Ver criativo</strong> para abrir a peça no Facebook e
          conferir a arte enquanto lê o número.
        </p>
        <div style={{ marginTop: 16 }}>
          <DateFilter
            since={since}
            until={until}
            onSinceChange={setSince}
            onUntilChange={setUntil}
            onPreset={setPreset}
          />
        </div>
      </header>

      {loading && <p className={s.state}>Carregando criativos…</p>}
      {error && <p className={s.state}>Não foi possível carregar os dados: {error}</p>}

      {data && !loading && (
        <>
          <dl className={s.summary}>
            <div className={s.scell}>
              <dt>Investido no período</dt>
              <dd>
                R$ {brl0(data.total_gasto)}
                <small>nas 3 frentes</small>
              </dd>
            </div>
            <div className={s.scell}>
              <dt>Resultados</dt>
              <dd>
                {brl0(data.total_resultados)}
                <small>leads + conversas</small>
              </dd>
            </div>
            <div className={s.scell}>
              <dt>Criativos no ar</dt>
              <dd>
                {data.total_criativos}
                <small>{data.ranking.length} com volume p/ julgar</small>
              </dd>
            </div>
            <div className={s.scell}>
              <dt>Melhor custo</dt>
              <dd>
                {melhor?.custo_por_resultado ? `R$ ${brl(melhor.custo_por_resultado)}` : "—"}
                <small>{melhor?.nome ?? "sem dados no período"}</small>
              </dd>
            </div>
          </dl>

          <div className={s.controls}>
            <span className={s.controlsLab}>Filtrar</span>
            {["todos", ...PRODUTOS].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setFiltro(p)}
                aria-pressed={filtro === p}
                className={`${s.filter} ${filtro === p ? s.filterOn : ""}`}
              >
                {p === "todos" ? "Todos" : p}
              </button>
            ))}
          </div>

          <h2 className={s.sectionTitle}>Ranking por custo por resultado</h2>
          <p className={s.sectionNote}>
            Só entram criativos com pelo menos R$ {data.min_gasto} investidos — abaixo disso o
            número ainda é ruído. <strong>Formulário</strong> e <strong>WhatsApp</strong> são
            resultados diferentes: compare com atenção entre tipos.
          </p>

          {ranking.length === 0 ? (
            <p className={s.state}>Nenhum criativo com volume suficiente neste período.</p>
          ) : (
            <div className={s.list}>
              {ranking.map((c, i) => {
                const cpr = c.custo_por_resultado ?? 0;
                return (
                  <article
                    key={`${c.produto}-${c.tipo}-${c.nome}`}
                    className={`${s.row} ${i === 0 ? s.rowTop : ""}`}
                  >
                    <div className={s.pos}>
                      <span className={`${s.posN} ${i < 3 ? s.posPodium : ""}`}>{i + 1}</span>
                    </div>
                    <Thumb src={c.thumbnail_url} alt={`Criativo ${c.nome}`} />
                    <div className={s.info}>
                      <h3>{c.nome}</h3>
                      <div className={s.chips}>
                        <span className={`${s.chip} ${s.chipProd}`}>{c.produto}</span>
                        <span
                          className={`${s.chip} ${c.tipo === "lead" ? s.chipLead : s.chipConv}`}
                        >
                          {c.tipo === "lead" ? "Formulário" : "WhatsApp"}
                        </span>
                        <span className={s.chip}>{c.campanha}</span>
                      </div>
                    </div>
                    <div className={s.metrics}>
                      <div className={`${s.cpr} ${tier(cpr)}`}>
                        <span className={s.cprVal}>R$&nbsp;{brl(cpr)}</span>
                        <span className={s.cprLab}>
                          por {c.tipo === "lead" ? "lead" : "conversa"}
                        </span>
                        <div className={s.bar}>
                          <span style={{ width: `${Math.max(4, (cpr / maxCpr) * 100)}%` }} />
                        </div>
                      </div>
                      <dl className={s.sub}>
                        <div>
                          <dt>Investido</dt>
                          <dd>R$&nbsp;{brl0(c.gasto)}</dd>
                        </div>
                        <div>
                          <dt>Resultados</dt>
                          <dd>{c.resultados}</dd>
                        </div>
                        <div>
                          <dt>CTR</dt>
                          <dd>{c.ctr.toFixed(2)}%</dd>
                        </div>
                      </dl>
                    </div>
                    <div className={s.action}>
                      {c.preview_url ? (
                        <a
                          className={s.btn}
                          href={c.preview_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Ver criativo ↗
                        </a>
                      ) : (
                        <span className={`${s.btn} ${s.btnOff}`}>sem preview</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <h2 className={s.sectionTitle}>Ainda sem volume para julgar</h2>
          <p className={s.sectionNote}>
            Criativos no ar que quase não receberam entrega — o algoritmo concentrou a verba
            nos vencedores. Não são ruins: nunca foram testados de verdade.
          </p>
          <div className={s.tablewrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Criativo</th>
                  <th>Produto</th>
                  <th className={s.num}>Investido</th>
                  <th className={s.num}>Result.</th>
                  <th className={s.num}>Custo</th>
                  <th>Preview</th>
                </tr>
              </thead>
              <tbody>
                {semVolume.length === 0 ? (
                  <tr>
                    <td colSpan={6}>Nenhum criativo nesta condição no período.</td>
                  </tr>
                ) : (
                  semVolume.map((c) => (
                    <tr key={`sv-${c.produto}-${c.tipo}-${c.nome}`}>
                      <td>{c.nome}</td>
                      <td>
                        <span className={`${s.chip} ${s.chipProd}`}>{c.produto}</span>
                      </td>
                      <td className={s.num}>R$ {brl(c.gasto)}</td>
                      <td className={s.num}>{c.resultados}</td>
                      <td className={s.num}>
                        {c.custo_por_resultado ? `R$ ${brl(c.custo_por_resultado)}` : "—"}
                      </td>
                      <td>
                        {c.preview_url ? (
                          <a
                            className={s.linkSm}
                            href={c.preview_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            ver ↗
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <p className={s.callout}>
            <strong>Como ler este ranking:</strong> o custo por resultado é o que importa, mas
            volume dá confiança — um criativo com centenas de resultados prova mais que um com
            três. Criativos com pouca entrega aparecem na segunda tabela: se já converteram
            gastando centavos, merecem um teste com verba dedicada.
          </p>

          <p className={s.foot}>
            Dados da API da Meta (act_538567668635736), atualizados pelo sync do BI. Custo por
            resultado = investimento ÷ resultados do próprio criativo, somando todos os
            conjuntos em que ele roda. O produto é definido pela campanha de origem — o nome da
            campanha nem sempre revela o imóvel anunciado.
          </p>
        </>
      )}
    </div>
  );
}
