"use client";
import { useState, useEffect, useCallback } from "react";

export function useDateRange() {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const [since, setSince] = useState(firstOfMonth.toISOString().split("T")[0]);
  const [until, setUntil] = useState(today.toISOString().split("T")[0]);

  const setPreset = useCallback((preset: string) => {
    const now = new Date();
    let s: Date;

    switch (preset) {
      case "hoje":
        s = now;
        break;
      case "ontem":
        s = new Date(now);
        s.setDate(s.getDate() - 1);
        setUntil(s.toISOString().split("T")[0]);
        setSince(s.toISOString().split("T")[0]);
        return;
      case "7d":
        s = new Date(now);
        s.setDate(s.getDate() - 7);
        break;
      case "30d":
        s = new Date(now);
        s.setDate(s.getDate() - 30);
        break;
      case "mtd":
        s = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      default:
        s = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    setSince(s.toISOString().split("T")[0]);
    setUntil(now.toISOString().split("T")[0]);
  }, []);

  return { since, until, setSince, setUntil, setPreset };
}

export function useFetch<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    setLoading(true);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("Erro ao carregar dados");
        return r.json();
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [url]);

  return { data, loading, error };
}
