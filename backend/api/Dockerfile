# Shared by all three Python services in docker-compose.yml (api, worker, scheduler) - same
# image, different `command:` per service. Keeps one Dockerfile to maintain instead of three
# near-identical ones.
FROM python:3.12-slim

WORKDIR /app

# gcc + libpq-dev are only needed to compile psycopg2 at install time - removed from the final
# layer's apt cache afterward to keep the image small.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Overridden by `command:` for the worker/scheduler services - this is just the api's default.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
