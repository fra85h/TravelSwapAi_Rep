// lib/ActivityContext.js — stato condiviso della casella Attività, così il
// numeretto rosso sul tab e la schermata leggono la stessa fonte e si
// aggiornano insieme (è la risposta al "non vedevo la proposta a 3":
// le cose da fare si contano sul tab, non restano nascoste).
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { loadActivity } from "./activity";

const EMPTY = { toDo: [], waiting: [], found: [], history: [] };

const ActivityContext = createContext({
  summary: EMPTY,
  toDoCount: 0,
  loading: true,
  refresh: () => {},
});

export function ActivityProvider({ children }) {
  const [summary, setSummary] = useState(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await loadActivity();
      setSummary({ toDo: s.toDo, waiting: s.waiting, found: s.found, history: s.history });
    } catch (e) {
      if (__DEV__) console.log("[Activity] refresh error", e?.message || e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <ActivityContext.Provider
      value={{ summary, toDoCount: summary.toDo.length, loading, refresh }}
    >
      {children}
    </ActivityContext.Provider>
  );
}

export const useActivity = () => useContext(ActivityContext);
