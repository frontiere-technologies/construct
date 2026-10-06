-- Correzione della 0029, che ha seminato i segnaposto con una graffa sola --
-- `{name}` invece di `{{name}}`. Il risultato non era un valore mancante ma un
-- valore sbagliato: il lettore di schermo annunciava alla lettera "Sollevato
-- {name}." Un seme non si corregge riscrivendo la migrazione che l'ha inserito
-- (e' gia' applicata e ha un checksum registrato), e nemmeno riseminando:
-- apply_translation_seed inserisce `on conflict do nothing`, quindi su una
-- chiave che esiste gia' non cambierebbe niente. Serve un aggiornamento.
--
-- Solo le sette chiavi della 0029, e solo dove il valore e' ancora quello
-- sbagliato: se qualcuno l'ha gia' corretto dal pannello Traduzioni, questa
-- migrazione non glielo sovrascrive.
update translation_value tv
set value = replace(replace(tv.value, '{name}', '{{name}}'), '{target}', '{{target}}'),
    updated_at = now()
from translation_key tk
where tk.id_translation_key = tv.id_translation_key
  and tk.key like 'functionalities.tree.dnd.%'
  and (tv.value like '%{name}%' or tv.value like '%{target}%');
