/**
 * Shown instantly while a page's data loads, so tab switches respond on click.
 * Next.js also prefetches this shell for links in view.
 */
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="bg-muted mb-2 h-7 w-48 rounded" />
      <div className="bg-muted mb-6 h-4 w-80 rounded" />
      <div className="mb-6 grid gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-muted h-20 rounded-xl" />
        ))}
      </div>
      <div className="bg-muted h-64 rounded-xl" />
    </div>
  );
}
