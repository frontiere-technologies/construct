export function EmbeddedBlockedNotice({ url }: { url: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4">
      <p className="text-sm text-foreground-muted">
        ⚠️ Questo sito non può essere visualizzato incorporato.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="embedded-blocked-open-new-tab"
        className="px-4 py-2 text-sm rounded-md bg-[var(--theme-primary)] text-white hover:opacity-90 transition-opacity"
      >
        Apri in una nuova scheda →
      </a>
    </div>
  )
}
