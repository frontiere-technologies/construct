export function LoadingStatus({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex items-center justify-center h-full min-h-[200px]">
      <div
        aria-hidden="true"
        className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin"
      />
    </div>
  )
}
