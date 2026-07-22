// lib/NotificationsContext.js — stato condiviso del centro notifiche: tiene il
// conteggio delle non lette per il pallino sul campanellino e lo aggiorna in
// tempo reale (Realtime) e su richiesta (quando una schermata segna "letto").
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "./supabase";
import {
  countUnreadNotifications,
  subscribeNotifications,
  subscribeNotificationsChanged,
} from "./notifications";

const NotificationsContext = createContext({ unreadCount: 0, refresh: () => {} });

export function NotificationsProvider({ children }) {
  const [unreadCount, setUnreadCount] = useState(0);
  const [userId, setUserId] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const n = await countUnreadNotifications();
      setUnreadCount(n);
    } catch { /* offline / non loggato: lascia il valore corrente */ }
  }, []);

  // Ricava l'utente corrente e tienilo aggiornato sui cambi di sessione.
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => { if (active) setUserId(data?.user?.id || null); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id || null);
    });
    return () => { active = false; try { sub?.subscription?.unsubscribe(); } catch {} };
  }, []);

  // Primo conteggio + Realtime + canale locale "segna letto".
  useEffect(() => {
    refresh();
    const offLocal = subscribeNotificationsChanged(refresh);
    const offRt = userId ? subscribeNotifications(userId, refresh) : () => {};
    return () => { offLocal(); offRt(); };
  }, [userId, refresh]);

  return (
    <NotificationsContext.Provider value={{ unreadCount, refresh }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export const useNotifications = () => useContext(NotificationsContext);
