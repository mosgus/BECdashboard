# --- Provenance -------------------------------------------------------------
# NOT a verbatim copy. Extracted from: main/LLM/service.py, lines 1-39
# (TCM.io, 2026-09-15). The source file is 440 lines and also builds property-
# research prompts, asset-summary prompts, and AM report generation — none of
# that is used by the news section. This file keeps only what
# news_summarizer.py actually imports: a constructed Gemini client and a
# model-name string.
#
# Credential resolution is copied as-is (file first, `st.secrets` fallback)
# because it's a reusable pattern worth keeping even outside Streamlit-Cloud
# deployments: check a local gitignored file first, fall back to whatever your
# platform's secrets mechanism is. Swap `st.secrets["GEMINI_KEY"]` for your
# own project's equivalent (env var, other secrets store, etc).
# -----------------------------------------------------------------------------
"""Minimal Gemini client construction, extracted for the news summarizer."""

from google import genai

# https://ai.google.dev/gemini-api/docs/models
gemini_model = "gemini-3.1-flash-lite"  # cheapest available model as of writing

try:
    with open("./keys/gemini_key.txt", "r") as f:
        _gemini_key = f.read().strip()
except FileNotFoundError:
    import streamlit as st
    _gemini_key = st.secrets["GEMINI_KEY"]

gem_client = genai.Client(api_key=_gemini_key)
