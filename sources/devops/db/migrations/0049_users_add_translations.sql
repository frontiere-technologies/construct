-- Multi-tenancy, pezzo 2 (specifica 2026-10-20, §3.2, MT2-OK-1): le parole del dialogo «Aggiungi persona»
-- nella pagina Utenti. Solo additiva: apply_translation_seed non riscrive mai una chiave esistente.
--
-- 1. Sette chiavi nuove: il bottone, il titolo, l'etichetta del campo, il bottone di conferma e i tre
--    esiti (fatto, email non valida, errore). L'esito «fatto» e' lo stesso per un account nuovo e per
--    uno esistente, cosi' il dialogo non rivela se l'indirizzo era gia' registrato.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"users.add.open","namespace":"users","module":"rbac","description":"Users page toolbar: button that opens the add-person dialog","it":"Aggiungi persona","en":"Add person"},
    {"key":"users.add.title","namespace":"users","module":"rbac","description":"Add-person dialog: title","it":"Aggiungi una persona","en":"Add a person"},
    {"key":"users.add.email_label","namespace":"users","module":"rbac","description":"Add-person dialog: label of the email field","it":"Email","en":"Email"},
    {"key":"users.add.submit","namespace":"users","module":"rbac","description":"Add-person dialog: button that adds the person","it":"Aggiungi","en":"Add"},
    {"key":"users.add.done","namespace":"users","module":"rbac","description":"Add-person dialog: outcome after a successful add. Neutral on purpose: it is the same for a new account (invited) and for an existing one (added)","it":"Persona aggiunta o invitata.","en":"Person added or invited."},
    {"key":"users.add.invalid_email","namespace":"users","module":"rbac","description":"Add-person dialog: shown when the text is not a valid email address","it":"Scrivi un indirizzo email valido.","en":"Enter a valid email address."},
    {"key":"users.add.error","namespace":"users","module":"rbac","description":"Add-person dialog: generic failure. The server message is never shown","it":"Non è stato possibile aggiungere la persona.","en":"Could not add the person."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
