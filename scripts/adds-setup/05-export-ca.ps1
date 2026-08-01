# Bước 5: xuất CA chain sang PEM cho LDAP_CA_FILE và sinh sẵn block .env.

. "$PSScriptRoot\config.ps1"
Assert-Admin
$ErrorActionPreference = 'Stop'

if (-not (Test-Path $ExportPath)) {
    New-Item -ItemType Directory -Path $ExportPath | Out-Null
}

$cerPath = Join-Path $ExportPath 'ad-ca.cer'
$pemPath = Join-Path $ExportPath 'ad-ca.pem'

Write-Step 'Xuat certificate cua CA'
& certutil -ca.cert $cerPath | Out-Null
if (-not (Test-Path $cerPath)) { throw 'Khong xuat duoc CA certificate.' }
Write-Ok $cerPath

Write-Step 'Chuyen sang PEM (base64)'
if (Test-Path $pemPath) { Remove-Item $pemPath -Force }
& certutil -encode $cerPath $pemPath | Out-Null
if (-not (Test-Path $pemPath)) { throw 'Khong encode duoc sang PEM.' }

$pem = Get-Content $pemPath -Raw
if ($pem -notmatch '-----BEGIN CERTIFICATE-----') {
    throw 'File PEM khong dung dinh dang.'
}
Write-Ok $pemPath

Write-Step 'Kiem tra chain cua certificate DC'
$dcCert = Get-ChildItem Cert:\LocalMachine\My | Where-Object {
    $_.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.1' -and
    $_.DnsNameList.Unicode -contains $DcFqdn -and
    $_.NotAfter -gt (Get-Date)
} | Sort-Object NotAfter -Descending | Select-Object -First 1

if ($dcCert) {
    $chain = New-Object Security.Cryptography.X509Certificates.X509Chain
    $null = $chain.Build($dcCert)
    Write-Ok "Chain co $($chain.ChainElements.Count) tang:"
    foreach ($element in $chain.ChainElements) {
        Write-Host "      - $($element.Certificate.Subject)"
    }
    if ($chain.ChainElements.Count -gt 2) {
        Write-Warn 'Chain co intermediate CA. Phai noi ca root + intermediate vao ad-ca.pem.'
        $chainPem = ''
        foreach ($element in $chain.ChainElements) {
            if ($element.Certificate.Subject -eq $dcCert.Subject) { continue }
            $b64 = [Convert]::ToBase64String($element.Certificate.RawData, 'InsertLineBreaks')
            $chainPem += "-----BEGIN CERTIFICATE-----`n$b64`n-----END CERTIFICATE-----`n"
        }
        Set-Content -Path $pemPath -Value $chainPem -Encoding ascii
        Write-Ok 'Da ghi day du chain vao ad-ca.pem'
    }
} else {
    Write-Warn "Khong tim thay certificate DC cho $DcFqdn. Chay lai 04-enable-ldaps.ps1."
}

$envBlock = @"
LDAP_ENABLED=false
LDAP_URL=ldaps://$DcFqdn`:636
LDAP_BASE_DN=$OuDN
LDAP_BIND_DN=$ServiceUpn
LDAP_BIND_PASSWORD_FILE=/etc/campha/secrets/ldap-bind-password
LDAP_CA_FILE=/etc/campha/certs/ad-ca.pem
LDAP_LOGIN_ATTRIBUTE=sAMAccountName
LDAP_ID_ATTRIBUTE=objectGUID
LDAP_EMAIL_ATTRIBUTE=mail
LDAP_NAME_ATTRIBUTE=displayName
LDAP_CONNECT_TIMEOUT_MS=5000
LDAP_OPERATION_TIMEOUT_MS=5000
LDAP_AUTH_RATE_LIMIT=10
LDAP_MAX_LOGIN_ATTEMPTS=3
"@

$envPath = Join-Path $ExportPath 'ldap.env.snippet'
Set-Content -Path $envPath -Value $envBlock -Encoding ascii
Write-Ok $envPath

Write-Host ''
Write-Host '--- Block .env cho VPS (LDAP_ENABLED van de false den khi UAT dat) ---' -ForegroundColor Cyan
Write-Host $envBlock
Write-Host '---------------------------------------------------------------------' -ForegroundColor Cyan
Write-Host ''
Write-Host "Copy $pemPath sang VPS: /etc/campha/certs/ad-ca.pem" -ForegroundColor Cyan
Write-Host 'Buoc tiep theo: chay 06-verify-ldaps.ps1' -ForegroundColor Cyan
