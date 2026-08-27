-- Il salvataggio del tema ora rifiuta i colori che non arrivano a 4,5:1 e dice
-- quali sono (GAP-9). Il pannello aveva un solo messaggio d'errore, generico:
-- «Save failed. Please retry.» non dice quale colore riaprire, e un rifiuto che
-- non nomina il colpevole non e' azionabile. I nomi dei colori in difetto li
-- compone il pannello dalle etichette che ha gia'; questa e' la frase che li
-- introduce.
--
-- Additive, like every other seed: apply_translation_seed inserts on conflict
-- do nothing, so re-running it changes nothing.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"theme.status.contrast_rejected","namespace":"theme","module":"rbac","description":"Save-failure footer message when one or more colours are below the 4.5:1 contrast floor; the offending colours are listed underneath","it":"Contrasto insufficiente: questi colori non raggiungono 4,5:1 sulle superfici del loro tema e non sono stati salvati.","en":"Contrast too low: these colours do not reach 4.5:1 on the surfaces of their own theme and were not saved."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
