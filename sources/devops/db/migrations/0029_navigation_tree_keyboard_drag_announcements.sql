-- A11Y-3. La maniglia di trascinamento dell'albero di navigazione ora funziona da
-- tastiera, e un trascinamento da tastiera senza annunci e' meta' lavoro: chi usa un
-- lettore di schermo non vede la linea di rilascio, quindi senza queste frasi non ha
-- alcun modo di sapere dove l'elemento andra' a finire.
--
-- Le prime due sono i due modi di dire la stessa cosa che dnd-kit chiama
-- `screenReaderInstructions` (lette al fuoco) e l'annuncio di sollevamento; le tre
-- `over_*` rispecchiano una per una le tre posizioni del modello di rilascio.
--
-- Additiva, come ogni seme: apply_translation_seed inserisce on conflict do nothing,
-- quindi rieseguirla non cambia niente.
do $$
declare v_summary text;
begin
  select public.apply_translation_seed($seed$[
    {"key":"functionalities.tree.dnd.instructions","namespace":"functionalities","module":"rbac","description":"Navigation tree drag: instructions read when the drag handle takes focus","it":"Premi Invio o Spazio per sollevare l'elemento. Usa le frecce Su e Giù per scegliere dove inserirlo, Destra per annidarlo nella categoria, Sinistra per tirarlo fuori. Invio per rilasciare, Escape per annullare.","en":"Press Enter or Space to lift the item. Use Up and Down to choose where to insert it, Right to nest it inside the category, Left to pull it back out. Enter to drop, Escape to cancel."},
    {"key":"functionalities.tree.dnd.lifted","namespace":"functionalities","module":"rbac","description":"Navigation tree drag: announced when an item is lifted","it":"Sollevato {name}.","en":"Lifted {name}."},
    {"key":"functionalities.tree.dnd.over_before","namespace":"functionalities","module":"rbac","description":"Navigation tree drag: announced when the drop position is above the hovered row","it":"{name} verrà inserito prima di {target}.","en":"{name} will be placed before {target}."},
    {"key":"functionalities.tree.dnd.over_after","namespace":"functionalities","module":"rbac","description":"Navigation tree drag: announced when the drop position is below the hovered row","it":"{name} verrà inserito dopo {target}.","en":"{name} will be placed after {target}."},
    {"key":"functionalities.tree.dnd.over_into","namespace":"functionalities","module":"rbac","description":"Navigation tree drag: announced when the drop position nests the item inside a category","it":"{name} verrà annidato dentro {target}.","en":"{name} will be nested inside {target}."},
    {"key":"functionalities.tree.dnd.dropped","namespace":"functionalities","module":"rbac","description":"Navigation tree drag: announced when the item is dropped","it":"{name} spostato.","en":"{name} moved."},
    {"key":"functionalities.tree.dnd.cancelled","namespace":"functionalities","module":"rbac","description":"Navigation tree drag: announced when the drag is cancelled or dropped nowhere","it":"Spostamento di {name} annullato.","en":"Moving {name} cancelled."}
  ]$seed$::jsonb) into v_summary;
  raise notice '%', v_summary;
end $$;
