-- La cella «Passaggio» dell'anteprima di Tema & Stili si chiama «Hover» anche in italiano, su
-- richiesta del proprietario del progetto (2026-10-05): e' il nome con cui la conosce chi lavora
-- sull'interfaccia, e «Passaggio» non si capiva.
--
-- Come nella 0030 e nella 0035: apply_translation_seed non riscrive un valore esistente, quindi
-- serve un aggiornamento, e solo dove il valore e' ancora quello della 0031, per non sovrascrivere
-- una correzione fatta dal pannello Traduzioni.
update translation_value tv
set value = 'Hover',
    updated_at = now()
from translation_key tk, app_language al
where tk.id_translation_key = tv.id_translation_key
  and al.id_language = tv.id_language
  and tk.key = 'theme.preview.swatch.hover'
  and al.code = 'it'
  and tv.value = 'Passaggio';
