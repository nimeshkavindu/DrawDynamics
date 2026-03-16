FROM python:3.11-slim

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy your backend code
COPY server.py .

# Cloud Run uses the $PORT environment variable (default 8080)
CMD uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080}