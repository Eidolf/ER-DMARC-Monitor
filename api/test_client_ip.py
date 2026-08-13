import unittest
from unittest.mock import MagicMock

def get_client_ip(request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()
        if client_ip:
            return client_ip
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()
    return request.client.host if request.client else "unknown"

class TestClientIPExtraction(unittest.TestCase):
    def test_x_forwarded_for_single_ip(self):
        req = MagicMock()
        req.headers = {"x-forwarded-for": "203.0.113.195"}
        req.client.host = "172.18.0.2"
        self.assertEqual(get_client_ip(req), "203.0.113.195")

    def test_x_forwarded_for_multiple_ips(self):
        req = MagicMock()
        req.headers = {"x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178"}
        req.client.host = "172.18.0.2"
        self.assertEqual(get_client_ip(req), "203.0.113.195")

    def test_x_real_ip_fallback(self):
        req = MagicMock()
        req.headers = {"x-real-ip": "198.51.100.42"}
        req.client.host = "172.18.0.2"
        self.assertEqual(get_client_ip(req), "198.51.100.42")

    def test_docker_direct_client_fallback(self):
        req = MagicMock()
        req.headers = {}
        req.client.host = "172.18.0.2"
        self.assertEqual(get_client_ip(req), "172.18.0.2")

if __name__ == "__main__":
    unittest.main()
