-- La 0015 intercettava il nome vuoto o fatto di soli spazi, non il nome non
-- vuoto ma privo di caratteri alfanumerici: "!!!" produceva un code di stringa
-- vuota, che il vincolo accetta perche' non e' nullo. Il runtime
-- (toPermissionCode) ha sempre avuto il ripiego 'permesso': questa allinea il
-- database a quel comportamento.
--
-- Sui dati attuali non ripara nulla — nessun permesso ha un nome del genere —
-- ed e' voluto: la 0015 e' gia' applicata e non si modifica, quindi la
-- correzione arriva come migrazione propria invece che come ritocco.
--
-- 'permesso-' || id_permission e non il nudo 'permesso': due righe con
-- entrambe un nome senza caratteri alfanumerici finirebbero altrimenti sullo
-- stesso code fisso, violando permission_code_unique (0015). Il suffisso
-- sull'id le tiene distinte, sempre.
update public.permission
set code = 'permesso-' || id_permission::text
where kind = 'GRANT' and (code is null or trim(code) = '');

-- Nota sulla divergenza dei suffissi, che qui c'entra perche' anche questo
-- ripiego ne porta uno: la disambiguazione per collisione nella 0015 (la
-- seconda update di quel file, quella che appende -<id_permission> ai code
-- duplicati) usa l'id_permission. A runtime, reserveUniqueCode
-- (lib/rbac/navigation-actions.ts) disambigua invece con un contatore che
-- parte da 2 (base-2, base-3, ...): la' l'identificativo non esiste ancora
-- quando il code va calcolato, prima dell'insert, e ottenerlo vorrebbe dire
-- scrivere il code e poi correggerlo — l'abitudine che DEC-3 vieta per un code
-- gia' assegnato. Le due forme non sono la stessa stringa, ma restano uniche
-- fra loro: reserveUniqueCode legge lo stato reale della tabella (compresi i
-- code nati da migrazione) prima di scegliere il proprio contatore, quindi non
-- propone mai un code gia' preso, da chiunque sia stato scritto.
