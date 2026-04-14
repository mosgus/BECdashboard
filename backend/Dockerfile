FROM python:3.11-slim

# System deps for scientific libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./

# Render sets $PORT dynamically; fall back to 8001 for local docker run
ENV PORT=8001
EXPOSE 8001

CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}"]
