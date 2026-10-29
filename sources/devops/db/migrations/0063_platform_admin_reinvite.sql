-- Multi-tenancy, pezzo 5a, revisione finale (specifica 2026-10-26, MT5-DEC-2, MT5-DEC-23): un
-- amministratore di piattaforma che non ha ancora una password (il link del primo invito è scaduto
-- dopo 48 ore, o l'email della console non è partita) non aveva modo di rientrare: nominarlo di
-- nuovo non faceva niente, toglierlo era vietato se era l'ultimo, e «Password dimenticata» non
-- esiste per un account senza password. Ora nominare di nuovo la stessa email, se l'account è già
-- amministratore e non ha una password, manda un invito nuovo e scrive la voce
-- `platform.admin.invite`. Qui le due parole che servono.
--
-- 1. L'etichetta della nuova operazione, nella griglia del registro (solo additiva: apply_translation_seed
--    non riscrive mai una chiave esistente).
-- 2. Il testo dell'errore d'invio, già riservato nella 0060, che diceva di togliere e aggiungere di
--    nuovo l'amministratore: ora dice di aggiungere la stessa email un'altra volta. Come nella 0030 e nella
--    0036 serve un aggiornamento, e solo dove il valore è ancora quello della 0060, per non
--    sovrascrivere una correzione fatta dal pannello Traduzioni.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key": "audit.operation.platform.admin.invite", "namespace": "audit", "module": "rbac", "description": "Audit grid: label of the operation code platform.admin.invite", "it": "Invito inviato a un amministratore di piattaforma", "en": "Invitation sent to a platform administrator"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;

update translation_value tv
set value = 'Amministratore aggiunto, ma l''email d''invito non è partita. La persona non ha ancora una password e «Password dimenticata» non le serve: aggiungi di nuovo la stessa email per rimandare l''invito.',
    updated_at = now()
from translation_key tk, app_language al
where tk.id_translation_key = tv.id_translation_key
  and al.id_language = tv.id_language
  and tk.key = 'platform.admins.add.done_invite_failed'
  and al.code = 'it'
  and tv.value = 'Amministratore aggiunto, ma l''email d''invito non è partita. La persona non ha ancora una password e «Password dimenticata» non le serve: togli l''amministratore e aggiungilo di nuovo per riprovare.';

update translation_value tv
set value = 'Administrator added, but the invitation email was not sent. The person has no password yet and «Forgot password» does not help: add the same email again to resend the invitation.',
    updated_at = now()
from translation_key tk, app_language al
where tk.id_translation_key = tv.id_translation_key
  and al.id_language = tv.id_language
  and tk.key = 'platform.admins.add.done_invite_failed'
  and al.code = 'en'
  and tv.value = 'Administrator added, but the invitation email was not sent. The person has no password yet and «Forgot password» does not help: remove the administrator and add them again to retry.';
