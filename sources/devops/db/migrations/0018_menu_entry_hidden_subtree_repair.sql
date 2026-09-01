-- La 0017 esclude dal travaso il sottoalbero di Operations per intero (ricorsivo), ma le altre
-- due condizioni di visibilita' -- coalesce(id_functionality_type, 0) = 5 e config_visibility = 1
-- -- le valuta riga per riga. L'applicazione invece le tratta come "nascondi tutto il
-- sottoalbero", non solo la riga: in lib/rbac/nav-tree-builder.ts un nodo con
-- config_visibility === 1 non entra nella mappa dei figli (childrenByParent), e la visita
-- ricorsiva raggiunge un discendente solo passando dal genitore -- quindi i discendenti di un
-- nodo nascosto non compaiono mai, anche se la riga del discendente non ha nulla che la nasconda
-- di per se'. In lib/rbac/sidebar-adapter.ts vale lo stesso attraverso il filtro finale
-- `emitted.has(m.parentId)`: un discendente di un nodo che isRenderable esclude (config_visibility
-- o id_functionality_type = FUNCTYPE_PERMISSION) resta fuori da `out` quando il genitore non c'e',
-- quindi viene scartato anche se la sua riga, isolata, sarebbe passata il controllo.
--
-- La 0017 e' gia' applicata: non si tocca. Questa migrazione non rifa' il travaso -- ripara lo
-- stato che la 0017 ha gia' scritto, cancellando le voci di menu_entry che non sarebbero dovute
-- nascere. Su un database dove la 0017 e' gia' passata (compreso quello di test), ripara quello
-- che trova; su un database applicato da zero le due migrazioni corrono in sequenza -- la 0017
-- inserisce ancora in modo asimmetrico, questa cancella subito dopo cio' che non doveva esserci --
-- e il risultato finale e' corretto in entrambi i casi.
--
-- id_permission = 0 (root) e' l'unica eccezione alla simmetria: root ha config_visibility = 1 sui
-- dati reali, ma non e' un nodo che l'applicazione nasconde per quel motivo -- lo esclude per
-- identita' (ROOT_ID), e i suoi figli restano visibili in base alla propria riga, non alla sua.
-- Trattarlo come un seme di "nascosti" travolgerebbe l'intero albero, perche' ogni riga discende
-- da root: verificato prima di scrivere la delete qui sotto, con una simulazione a valori
-- letterali che non tocca alcuna tabella reale (vedi il report per il dettaglio). -1 (Operations)
-- resta seme legittimo: e' gia' un sottoalbero nascosto per intero nella 0017, e config_visibility
-- = 1 su quella riga non aggiunge nulla che l'`id_permission = -1` esplicito non copra gia'.
with recursive nascosti as (
  select id_permission from public.permission
  where id_permission = -1
     or (id_permission <> 0 and (coalesce(id_functionality_type, 0) = 5 or config_visibility = 1))
  union all
  select c.id_permission from public.permission c
  join nascosti d on c.id_parent = d.id_permission
)
-- id_menu_entry riusa l'id del permesso originale (vedi 0017): e' quel numero, non
-- menu_entry.id_permission (nullo per categorie e voci pubbliche), a corrispondere alla riga di
-- permission che non sarebbe dovuta generare una voce. on delete cascade su menu_entry.id_parent
-- e su menu_entry_tag.id_menu_entry fa il resto: cancellare qui una voce cancella anche i suoi
-- discendenti gia' inseriti in menu_entry e i loro tag, senza bisogno di ripeterlo a mano.
delete from public.menu_entry
where id_menu_entry in (select id_permission from nascosti);
