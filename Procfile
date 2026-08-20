web: sh scripts/start-web.sh
worker: celery -A backend.jobs.celery_app worker --include=backend.jobs.tasks --loglevel=info --concurrency=2 -Q korvix.default,korvix.research,korvix.vision,korvix.embeddings,korvix.orchestration,korvix.maintenance
