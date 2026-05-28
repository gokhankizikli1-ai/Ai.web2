web: uvicorn api:app --host 0.0.0.0 --port $PORT
worker: celery -A backend.jobs.celery_app worker --include=backend.jobs.tasks --loglevel=info --concurrency=2 -Q korvix.default,korvix.research,korvix.vision,korvix.embeddings,korvix.orchestration,korvix.maintenance
