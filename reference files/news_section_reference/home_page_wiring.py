# --- Provenance -------------------------------------------------------------
# Trimmed excerpt from: main/pages/Home/Home.py (TCM.io, 2026-09-15).
# NOT a verbatim full-file copy — the original also renders a deal-approval
# queue widget, an upcoming-key-dates widget, and a paginated changelog table,
# none of which are part of the news section. Only the import and the one
# call site are shown, to demonstrate that render_news_section() is a
# self-contained call with no arguments and no return value: it does all of
# its own data fetching, session-state management, and rendering internally.
#
# The original file also does two things NOT shown here that are unrelated to
# news but worth knowing if you're modeling the whole page: it applies a
# shared CSS bundle (`CSS_HOME`, styles only the queue widget) and an inline
# <style> block that caps the page's content width at 900px (Streamlit's
# global layout is "wide" by default; Home overrides it locally).
# -----------------------------------------------------------------------------

from home_modules.news import render_news_section

# ... (deal-queue widget renders above this point; omitted, not news-related)

render_news_section()

# ... (st.divider(), upcoming-key-dates widget, changelog table all render
#      below this point; omitted, not news-related)
