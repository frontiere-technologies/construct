-- La revisione finale del ramo ha trovato che `updateNavigationItem` scriveva la nuova
-- tipologia sulla voce di menu senza mai creare il permesso corrispondente: una categoria
-- convertita in funzionalita' restava con `id_permission` nullo, cioe' una voce PUBBLICA e
-- ingovernabile, perche' una voce senza permesso non compare in Ruoli & Permessi. La
-- decisione e' stata di rifiutare la conversione invece di implementarla: il server la
-- respinge in entrambi i versi e la tendina «Tipologia» e' disabilitata in modifica
-- (`typeLocked = mode === 'edit'` in FunctionalityForm.tsx).
--
-- Una tendina disabilitata senza spiegazione e' un vicolo cieco: l'utente vede un controllo
-- che non risponde e non sa perche'. Il rimedio e' il `title` di cortesia, come per il
-- «Genitore» bloccato (`functionalities.form.parent_locked_*_hint`, seminate nella 0001) —
-- ma la chiave nuova non era mai stata seminata, perche' il compito che ha scritto il
-- rifiuto aveva le migrazioni fuori dal proprio perimetro. Fino a questa migrazione il
-- tooltip mostrava la chiave grezza.
--
-- Additiva, come ogni seme: apply_translation_seed inserisce on conflict do nothing, quindi
-- rieseguirla non cambia niente.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"functionalities.form.type_locked_edit_hint","namespace":"functionalities","module":"rbac","description":"Tipologia disabled-select tooltip, edit mode: converting a category into a functionality (or back) is refused, so the type is fixed at creation","it":"La tipologia non può essere modificata dopo la creazione","en":"The type cannot be changed after creation"}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
