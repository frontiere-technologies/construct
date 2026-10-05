-- Le celle dell'anteprima della pagina Tema & Stili non aprono piu' il selettore: scelgono cosa
-- cambiare nel pannello sotto (0034). Il nome accessibile finiva con ", modifica", che prometteva
-- un'azione che la cella non fa piu'; diventa una descrizione senza verbo. E la descrizione di
-- theme.preview.edit_hint parlava ancora delle superfici che aprono il selettore.
--
-- Come nella 0030 e nella 0034: apply_translation_seed non riscrive un valore esistente, quindi
-- serve un aggiornamento, e solo dove il valore e' ancora quello della 0033, per non sovrascrivere
-- una correzione fatta dal pannello Traduzioni.

update translation_value tv
set value = case tv.value
      when '{{surface}}, {{mode}}: {{color}}, modifica' then '{{surface}}, {{mode}}: {{color}}'
      when '{{surface}}, {{mode}}: {{color}}, edit' then '{{surface}}, {{mode}}: {{color}}'
      when '{{surface}}, {{mode}}: {{color}} — personalizzato, modifica' then '{{surface}}, {{mode}}: {{color}} — personalizzato'
      when '{{surface}}, {{mode}}: {{color}} — customised, edit' then '{{surface}}, {{mode}}: {{color}} — customised'
    end,
    updated_at = now()
from translation_key tk
where tk.id_translation_key = tv.id_translation_key
  and tk.key in ('theme.preview.cell_label', 'theme.preview.cell_label_customised')
  and tv.value in (
    '{{surface}}, {{mode}}: {{color}}, modifica',
    '{{surface}}, {{mode}}: {{color}}, edit',
    '{{surface}}, {{mode}}: {{color}} — personalizzato, modifica',
    '{{surface}}, {{mode}}: {{color}} — customised, edit'
  );

update translation_key set description = case key
    when 'theme.preview.cell_label' then 'Theme admin: accessible name of a preview cell, which selects what the choice panel edits. {{surface}} = cell name, {{mode}} = light/dark, {{color}} = hex'
    when 'theme.preview.cell_label_customised' then 'Theme admin: accessible name of a preview surface cell the admin changed. {{surface}} = cell name, {{mode}} = light/dark, {{color}} = hex'
    when 'theme.preview.edit_hint' then 'Theme admin: hint under the preview, a cell selects what the choice panel below edits'
  end
where key in ('theme.preview.cell_label', 'theme.preview.cell_label_customised', 'theme.preview.edit_hint');
