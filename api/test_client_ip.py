import unittest
from unittest.mock import MagicMock
from fastapi import Request
from main import get_client_ip

class TestClientIPExtraction(unittest.TestCase):
    def test_x_forwarded_for_single_ip(self) -> None:
        req = MagicMock(spec=Request)
        req.headers = {"x-forwarded-for": "203.0.113.195"}
        req.client = MagicMock()
        req.client.host = "172.18.0.2"
        self.assertEqual(get_client_ip(req), "203.0.113.195")

    def test_x_forwarded_for_multiple_ips(self) -> None:
        req = MagicMock(spec=Request)
        req.headers = {"x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178"}
        req.client = MagicMock()
        req.client.host = "172.18.0.2"
        self.assertEqual(get_client_ip(req), "203.0.113.195")

    def test_x_real_ip_fallback(self) -> None:
        req = MagicMock(spec=Request)
        req.headers = {"x-real-ip": "198.51.100.42"}
        req.client = MagicMock()
        req.client.host = "172.18.0.2"
        self.assertEqual(get_client_ip(req), "198.51.100.42")

        # Whitespace-only real-ip header regression case
        req_whitespace = MagicMock(spec=Request)
        req_whitespace.headers = {"x-real-ip": "   "}
        req_whitespace.client = MagicMock()
        req_whitespace.client.host = "172.18.0.2"
        self.assertEqual(get_client_ip(req_whitespace), "172.18.0.2")

    def test_docker_direct_client_fallback(self) -> None:
        req = MagicMock(spec=Request)
        req.headers = {}
        req.client = MagicMock()
        req.client.host = "172.18.0.2"
        self.assertEqual(get_client_ip(req), "172.18.0.2")

        # req.client is None case
        req_none = MagicMock(spec=Request)
        req_none.headers = {}
        req_none.client = None
        self.assertEqual(get_client_ip(req_none), "unknown")

if __name__ == "__main__":
    unittest.main()
