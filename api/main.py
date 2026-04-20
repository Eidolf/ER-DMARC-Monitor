from fastapi import FastAPI

app = FastAPI(title="DMARC Monitoring API")

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.get("/domains")
def get_domains():
    # Return stub data
    return [
        {"id": 1, "name": "example.com", "dmarc_policy": "reject"}
    ]
