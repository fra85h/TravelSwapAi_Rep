// hooks/useProfile.js
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export function useProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setProfile(null); setLoading(false); return; }

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error && error.code === 'PGRST116') {
        // non esiste → crealo veloce
        const username = user.email?.split('@')[0] || `user_${user.id.substring(0, 6)}`;
        await supabase.from('profiles').insert({ id: user.id, username }).select().single();
        const { data: re } = await supabase.from('profiles').select('*').eq('id', user.id).single();
        if (mounted) setProfile(re);
      } else if (!error && mounted) {
        setProfile(data);
      }
      if (mounted) setLoading(false);
    })();

    return () => { mounted = false; };
  }, []);

  return { profile, loading };
}
