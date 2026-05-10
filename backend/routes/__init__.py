# Routes are registered individually in backend/api.py via importlib,
# so this package __init__ is intentionally empty.
# Do NOT add eager module imports here — a single broken route file would
# crash the entire application on startup.
