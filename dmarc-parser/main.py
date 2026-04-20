import time

def main():
    print("DMARC Parser Worker started. Waiting for REDIS events...")
    while True:
        time.sleep(3600)

if __name__ == "__main__":
    main()
