param (
    [string]$HostName = "localhost",
    [int]$Port = 13062,
    [string]$Domain = "test-domain.com",
    [string]$Recipient = "report@dmarc.domain.com"
)

$Subject = "Report Domain: $Domain Submit Date: $(Get-Date -Format 'yyyy-MM-dd')"
$Body = "DMARC Test Message"
$XmlContent = @"
<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <report_metadata>
    <org_name>POWERSHELL-TEST</org_name>
    <email>test@ps.org</email>
    <report_id>PS-$([guid]::NewGuid().ToString().Substring(0,8))</report_id>
    <date_range>
      <begin>$([int](Get-Date (Get-Date).AddDays(-1) -UFormat %s))</begin>
      <end>$([int](Get-Date -UFormat %s))</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>$Domain</domain>
    <p>none</p>
  </policy_published>
  <record>
    <row>
      <source_ip>8.8.8.8</source_ip>
      <count>1</count>
      <policy_evaluated>
        <disposition>none</disposition>
      </policy_evaluated>
    </row>
  </record>
</feedback>
"@

$TempFile = [System.IO.Path]::GetTempFileName() + ".xml"
$XmlContent | Out-File -FilePath $TempFile -Encoding UTF8

Write-Host "Sending DMARC test report to $HostName:$Port..."

# Using .NET SmtpClient for better port control
$SmtpClient = New-Object Net.Mail.SmtpClient($HostName, $Port)
$MailMessage = New-Object Net.Mail.MailMessage
$MailMessage.From = "tester@external.org"
$MailMessage.To.Add($Recipient)
$MailMessage.Subject = $Subject
$MailMessage.Body = $Body
$MailMessage.Headers.Add("X-DMARC-Test", "true")

$Attachment = New-Object Net.Mail.Attachment($TempFile)
$Attachment.ContentType = New-Object Net.Mail.Headers.ContentType("application/xml")
$Attachment.Name = "rua-test.xml"
$MailMessage.Attachments.Add($Attachment)

try {
    $SmtpClient.Send($MailMessage)
    Write-Host "Success: Test report sent." -ForegroundColor Green
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    $Attachment.Dispose()
    Remove-Item $TempFile
}
