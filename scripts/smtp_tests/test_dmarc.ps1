param (
    [Parameter(Mandatory=$false)][string]$HostName = "localhost",
    [Parameter(Mandatory=$false)][int]$Port = 13062,
    [Parameter(Mandatory=$true)][string]$Domain,
    [Parameter(Mandatory=$true)][string]$Recipient,
    [Parameter(Mandatory=$false)][switch]$NoTest
)

$Subject = "Report Domain: $Domain Submit Date: $(Get-Date -Format 'yyyy-MM-dd')"
$Body = "DMARC Test Message sent via PowerShell"
$XmlContent = @"
<?xml version="1.0" encoding="UTF-8" ?>
<feedback>
  <report_metadata>
    <org_name>POWERSHELL-TEST-TOOL</org_name>
    <email>noreply@ps-test.org</email>
    <report_id>PS-$([guid]::NewGuid().ToString().Substring(0,8))</report_id>
    <date_range>
      <begin>$([int]((Get-Date).AddDays(-1).ToUniversalTime() - (Get-Date "1970-01-01 00:00:00")).TotalSeconds)</begin>
      <end>$([int]((Get-Date).ToUniversalTime() - (Get-Date "1970-01-01 00:00:00")).TotalSeconds)</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>$Domain</domain>
    <adkim>r</adkim>
    <aspf>r</aspf>
    <p>none</p>
    <sp>none</sp>
    <pct>100</pct>
  </policy_published>
  <record>
    <row>
      <source_ip>127.0.0.1</source_ip>
      <count>1</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>$Domain</header_from>
    </identifiers>
    <auth_results>
      <dkim>
        <domain>$Domain</domain>
        <result>pass</result>
        <selector>default</selector>
      </dkim>
      <spf>
        <domain>$Domain</domain>
        <result>pass</result>
        <scope>mfrom</scope>
      </spf>
    </auth_results>
  </record>
</feedback>
"@

$TempFile = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "$([guid]::NewGuid().ToString()).xml")
$XmlContent | Out-File -FilePath $TempFile -Encoding UTF8

Write-Host "Connecting to $($HostName):$Port..."

# Using .NET SmtpClient for better port control
$SmtpClient = New-Object Net.Mail.SmtpClient($HostName, $Port)
$MailMessage = New-Object Net.Mail.MailMessage
$MailMessage.From = "ps-test@external.tool"
$MailMessage.To.Add($Recipient)
$MailMessage.Subject = $Subject
$MailMessage.Body = $Body

if (-not $NoTest) {
    $MailMessage.Headers.Add("X-DMARC-Test", "true")
    Write-Host "Flagging message as TEST DATA (X-DMARC-Test: true)"
}

$Attachment = New-Object Net.Mail.Attachment($TempFile)
# Fix for Type discovery in some PS environments
$Attachment.ContentType.MediaType = "application/xml"
$Attachment.Name = "rua-report.xml"
$MailMessage.Attachments.Add($Attachment)

try {
    $SmtpClient.Send($MailMessage)
    Write-Host "Success: DMARC test report sent successfully." -ForegroundColor Green
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    if ($_.Exception.InnerException) {
        Write-Host "Details: $($_.Exception.InnerException.Message)" -ForegroundColor Yellow
    }
} finally {
    $Attachment.Dispose()
    $MailMessage.Dispose()
    $SmtpClient.Dispose()
    if (Test-Path $TempFile) { Remove-Item $TempFile }
}
