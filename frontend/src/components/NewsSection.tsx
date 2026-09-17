import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { getNews } from '../api/client'
import type { NewsArticle, NewsSummary } from '../api/client'
import { relativeTime } from '../lib/relativeTime'
import { Tooltip } from './Tooltip'

const LIMIT = 20
const MAX_PER_TICKER = 2
const CARDS_PER_PAGE = 6
const VISIBLE_LIST_ROWS = 5

/** w-full is load-bearing here, not belt-and-braces. Tooltip wraps its child in an
 * `inline-flex` span, so the card ends up a flex item in a row-direction container and does not
 * stretch along the main axis — without it the card is sized by its content, and a card whose
 * thumbnail is narrower than its neighbours' renders narrower than they do. h-full removed
 * so cards don't stretch vertically on slides with fewer than 6 articles. */
const CARD_CLASS =
  'flex flex-col w-full bg-brand-surface border border-brand-border ' +
  'rounded-[var(--radius-card)] overflow-hidden hover:opacity-90 transition-opacity'

function hasThumbnail(article: NewsArticle): boolean {
  return typeof article.thumbnail_url === 'string' && article.thumbnail_url.length > 0
}

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size))
  }
  return pages
}

/** publisher already holds content.provider.displayName ("Insider Monkey" reads better than
 * "insidermonkey.com") — the URL's hostname is only a fallback for the rare row without one. */
function publisherLabel(article: NewsArticle): string {
  if (article.publisher) return article.publisher
  if (!article.url) return ''
  try {
    return new URL(article.url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function ExternalLink({
  url,
  className,
  children,
}: {
  url: string | null
  className: string
  children: ReactNode
}): JSX.Element {
  if (!url) return <div className={className}>{children}</div>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  )
}

function ArticleCard({ article, now }: { article: NewsArticle; now: Date }): JSX.Element {
  const [imageFailed, setImageFailed] = useState(false)
  const publisher = publisherLabel(article)
  const time = relativeTime(article.pub_date, now)
  const showImage = !imageFailed && hasThumbnail(article)

  return (
    <Tooltip label={`${article.title} — ${publisher}`}>
      <ExternalLink
        url={article.url}
        className={CARD_CLASS}
      >
        {showImage && (
          <img
            src={article.thumbnail_url ?? undefined}
            alt=""
            className="w-full h-40 object-cover"
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        )}
        <div className="flex flex-col gap-1.5 p-4 flex-1">
          {publisher && <span className="text-xs text-[var(--color-muted)]">{publisher}</span>}
          <h3 className="text-sm font-semibold text-foreground leading-snug line-clamp-3">
            {article.title}
          </h3>
          {time && <span className="text-xs text-[var(--color-muted)] mt-auto pt-1">{time}</span>}
        </div>
      </ExternalLink>
    </Tooltip>
  )
}

function ArticleRow({ article, now }: { article: NewsArticle; now: Date }): JSX.Element {
  const publisher = publisherLabel(article)
  const time = relativeTime(article.pub_date, now)

  return (
    <Tooltip label={`${article.title} — ${publisher}`}>
      <div className="w-full py-1.5 text-sm truncate">
        <ExternalLink url={article.url} className="text-foreground hover:underline">
          {article.title}
        </ExternalLink>
        {publisher && <span className="text-[var(--color-muted)]"> · {publisher}</span>}
        {time && <span className="text-[var(--color-muted)]"> · {time}</span>}
      </div>
    </Tooltip>
  )
}

function Briefing({ summary, now }: { summary: NewsSummary; now: Date }): JSX.Element {
  return (
    <div className="bg-brand-surface border border-brand-border rounded-[var(--radius-card)] p-5 mb-6">
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-xs uppercase tracking-wide text-[var(--color-muted)]">
          Market briefing · AI-generated
        </span>
        <span className="text-xs text-[var(--color-muted)]">
          {relativeTime(summary.created_at, now)}
        </span>
      </div>
      <p className="font-briefing text-base leading-relaxed">{summary.text}</p>
    </div>
  )
}

function PageButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  // Tooltip's hover listeners live on its own wrapping span, not on the button itself, so
  // hover still shows the tooltip when the button is disabled — a plain `title` attribute
  // would not: browsers do not fire mouse events on a disabled control at all.
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className="w-10 h-10 flex items-center justify-center rounded-full bg-brand-primary text-white text-lg font-semibold disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:opacity-90"
      >
        {children}
      </button>
    </Tooltip>
  )
}

export function NewsSection(): JSX.Element | null {
  const [articles, setArticles] = useState<NewsArticle[]>([])
  const [summary, setSummary] = useState<NewsSummary | null>(null)
  const [failed, setFailed] = useState(false)
  const [page, setPage] = useState(0)

  useEffect(() => {
    let cancelled = false

    getNews(LIMIT, MAX_PER_TICKER)
      .then((response) => {
        if (!cancelled) {
          setArticles(response.articles)
          setSummary(response.summary)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [])

  // articles only ever changes once today (the fetch above never re-runs), but a page index
  // left over from a previous, larger article set would otherwise be able to point past the
  // end of a smaller one.
  useEffect(() => {
    setPage(0)
  }, [articles])

  if (failed || articles.length === 0) return null

  const now = new Date()
  // Every thumbnailed article is a card now (0032 capped this at 6 and pushed the rest into
  // the list; Gunnar asked for paging instead). The list reverts to the reference's role:
  // thumbnail-less articles only.
  const cards = articles.filter(hasThumbnail)
  const listArticles = articles.filter((article) => !hasThumbnail(article))
  const visibleRows = listArticles.slice(0, VISIBLE_LIST_ROWS)
  const overflowRows = listArticles.slice(VISIBLE_LIST_ROWS)

  const pages = chunk(cards, CARDS_PER_PAGE)
  const totalPages = pages.length

  return (
    <section className="mt-14">
      {summary && summary.text && <Briefing summary={summary} now={now} />}
      {cards.length > 0 && (
        <div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 mb-3">
              <PageButton
                label="Previous articles"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                ‹
              </PageButton>
              <span className="text-sm font-semibold text-brand-primary tabular-nums">
                {page + 1} / {totalPages}
              </span>
              <PageButton
                label="Next articles"
                disabled={page === totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                ›
              </PageButton>
            </div>
          )}
          <div className="overflow-hidden">
            <div
              className="flex transition-transform duration-500 ease-in-out motion-reduce:transition-none"
              style={{ transform: `translateX(-${page * 100}%)` }}
            >
              {pages.map((pageCards, i) => (
                // Every page stays mounted so the track can slide, which leaves off-screen cards
                // focusable: without this a keyboard user tabs through all the hidden links before
                // reaching anything visible. `inert` removes them from the tab order and the
                // accessibility tree, and React 19 takes it as a real boolean prop.
                <div
                  key={i}
                  inert={i !== page}
                  className="w-full shrink-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 auto-rows-max gap-5"
                >
                  {pageCards.map((article) => (
                    <ArticleCard key={article.id} article={article} now={now} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {listArticles.length > 0 && (
        <div className={`flex flex-col divide-y divide-brand-border ${cards.length > 0 ? 'mt-6' : ''}`}>
          {visibleRows.map((article) => (
            <ArticleRow key={article.id} article={article} now={now} />
          ))}
          {overflowRows.length > 0 && (
            <details>
              {/* list-none alone leaves WebKit's triangle visible; the reference hid it with the
                  same pseudo-element (news_section.py:352). */}
              <summary className="py-1.5 text-sm text-[var(--color-muted)] cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <Tooltip label={`Show ${overflowRows.length} more headlines`}>
                  <span>… {overflowRows.length} more</span>
                </Tooltip>
              </summary>
              <div className="flex flex-col divide-y divide-brand-border">
                {overflowRows.map((article) => (
                  <ArticleRow key={article.id} article={article} now={now} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  )
}
