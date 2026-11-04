// GENERATED from lib/rbac/menu-target-url.ts; run node sources/devops/db/generate-menu-target-url.mjs
/** Normalizza la destinazione che il renderer precedente apriva, senza riscrivere il valore
 * di authoring. Nessun import framework: la CLI usa il modulo generato da questo sorgente. */
export function normalizeMenuTargetUrl(link, functionalityType, appOrigin) {
    if (functionalityType === null)
        return null;
    if (!link?.trim())
        throw new Error('menu_target_required');
    // Prima della canonicalizzazione va conservata la regola href della sidebar: ftp/mailto/tel
    // venivano aperti come percorsi Home. Gli iframe, invece, ricevevano l'URI direttamente.
    const rendered = functionalityType === 1 || link.startsWith('/') || link.startsWith('http') ? link : '/' + link;
    const syntax = rendered.trim().replace(/[\t\n\r]/g, '');
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(syntax);
    const hasAuthority = /^[\\/]{2}/.test(syntax);
    if (!appOrigin && (hasScheme || hasAuthority))
        throw new Error('menu_origin_required');
    const origin = appOrigin ? new URL(appOrigin).origin : 'https://menu-relative.invalid';
    const target = new URL(rendered, origin + '/');
    if (['javascript:', 'data:', 'vbscript:', 'file:', 'blob:'].includes(target.protocol))
        throw new Error('unsafe_menu_target');
    if (hasScheme)
        return target.href;
    if (hasAuthority || target.origin !== origin)
        return target.href.slice(target.protocol.length);
    // Una pathname che inizia con // non deve diventare un'autorità quando torna un href relativo.
    const path = target.pathname.startsWith('//') ? '/.' + target.pathname : target.pathname;
    return path + target.search + target.hash;
}
