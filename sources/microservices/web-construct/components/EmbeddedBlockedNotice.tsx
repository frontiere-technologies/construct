import { isHttpUrl } from '@/lib/rbac/embedded-check'
import { getI18n } from '@/lib/i18n/server'

export async function EmbeddedBlockedNotice({ url }: { url: string }) {
  const isSafeUrl = isHttpUrl(url)
  const { t } = await getI18n()

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4">
      <p className="text-sm text-muted-foreground">
        {t('embedded.blocked_title')}
      </p>
      {isSafeUrl ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="embedded-blocked-open-new-tab"
          className="px-4 py-2 text-sm rounded-md bg-[var(--theme-primary)] text-white hover:opacity-90 transition-opacity"
        >
          {t('embedded.blocked_body')}
        </a>
      ) : (
        <p className="text-sm text-muted-foreground break-all">{url}</p>
      )}
    </div>
  )
}
