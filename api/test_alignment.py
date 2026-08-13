import unittest
from dns_utils import get_org_domain

class TestAlignmentEvaluation(unittest.TestCase):
    def get_org_domain(self, dom: str | None) -> str:
        return get_org_domain(dom)

    def evaluate_alignment(self, domain_name: str, spf_res_list: list[dict], dkim_res_list: list[dict]) -> tuple[bool, bool]:
        target_org = self.get_org_domain(domain_name)

        dkim_pass = any(
            d["result"] == "pass" and self.get_org_domain(d.get("domain")) == target_org
            for d in dkim_res_list
        )
        spf_pass = any(
            s["result"] == "pass" and 
            (s.get("scope") == "mfrom" or s.get("scope") is None) and 
            self.get_org_domain(s.get("domain")) == target_org
            for s in spf_res_list
        )
        return spf_pass, dkim_pass

    def test_spf_unaligned_pass(self) -> None:
        domain_name = "eidolf.de"
        spf_res_list = [{"domain": "osplwbeout01-10.prod.phx3.secureserver.net", "result": "pass", "scope": "mfrom"}]
        dkim_res_list = [{"domain": "eidolf.de", "result": "pass"}]

        spf_pass, dkim_pass = self.evaluate_alignment(domain_name, spf_res_list, dkim_res_list)
        self.assertFalse(spf_pass, "Unaligned SPF domain must not result in overall spf_pass=True for DMARC evaluation")
        self.assertTrue(dkim_pass)

    def test_spf_aligned_pass(self) -> None:
        domain_name = "eidolf.de"
        spf_res_list = [{"domain": "mail.eidolf.de", "result": "pass", "scope": "mfrom"}]
        dkim_res_list = []

        spf_pass, dkim_pass = self.evaluate_alignment(domain_name, spf_res_list, dkim_res_list)
        self.assertTrue(spf_pass, "Aligned SPF domain with mfrom scope must result in spf_pass=True")

    def test_spf_helo_scope_not_aligned(self) -> None:
        domain_name = "eidolf.de"
        spf_res_list = [{"domain": "mail.eidolf.de", "result": "pass", "scope": "helo"}]
        dkim_res_list = []

        spf_pass, dkim_pass = self.evaluate_alignment(domain_name, spf_res_list, dkim_res_list)
        self.assertFalse(spf_pass, "SPF result with helo scope must not result in spf_pass=True for DMARC")

    def test_multi_part_tld_alignment(self) -> None:
        domain_name = "example.co.uk"
        self.assertEqual(get_org_domain("sub.example.co.uk"), "example.co.uk")
        self.assertEqual(get_org_domain("mail.example.co.uk"), "example.co.uk")
        self.assertEqual(get_org_domain("co.uk"), "co.uk")

if __name__ == "__main__":
    unittest.main()
