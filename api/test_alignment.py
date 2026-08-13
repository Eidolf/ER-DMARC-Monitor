import unittest
import json

class TestAlignmentEvaluation(unittest.TestCase):
    def get_org_domain(self, dom):
        if not dom: return ""
        parts = dom.lower().strip('.').split('.')
        return '.'.join(parts[-2:]) if len(parts) >= 2 else dom.lower()

    def evaluate_alignment(self, domain_name, spf_res_list, dkim_res_list):
        target_org = self.get_org_domain(domain_name)

        dkim_pass = any(
            d["result"] == "pass" and self.get_org_domain(d.get("domain")) == target_org
            for d in dkim_res_list
        )
        spf_pass = any(
            s["result"] == "pass" and self.get_org_domain(s.get("domain")) == target_org
            for s in spf_res_list
        )
        return spf_pass, dkim_pass

    def test_spf_unaligned_pass(self):
        # User scenario: report domain is eidolf.de, SPF domain is secureserver.net
        domain_name = "eidolf.de"
        spf_res_list = [{"domain": "osplwbeout01-10.prod.phx3.secureserver.net", "result": "pass"}]
        dkim_res_list = [{"domain": "eidolf.de", "result": "pass"}]

        spf_pass, dkim_pass = self.evaluate_alignment(domain_name, spf_res_list, dkim_res_list)
        self.assertFalse(spf_pass, "Unaligned SPF domain must not result in overall spf_pass=True for DMARC evaluation")
        self.assertTrue(dkim_pass)

    def test_spf_aligned_pass(self):
        domain_name = "eidolf.de"
        spf_res_list = [{"domain": "mail.eidolf.de", "result": "pass"}]
        dkim_res_list = []

        spf_pass, dkim_pass = self.evaluate_alignment(domain_name, spf_res_list, dkim_res_list)
        self.assertTrue(spf_pass, "Aligned SPF domain must result in spf_pass=True")

if __name__ == "__main__":
    unittest.main()
