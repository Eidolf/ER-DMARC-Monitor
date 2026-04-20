FROM python:3.14-slim

WORKDIR /app
COPY requirements.txt .
RUN apt-get update && apt-get install -y gcc libpq-dev && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Wait for database/migrations realistically
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
