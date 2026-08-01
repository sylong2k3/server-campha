# Bước 4: cài Enterprise Root CA, cấp certificate cho DC để bật LDAPS (port 636),
# siết LDAP signing và giới hạn firewall chỉ cho VPS app.

. "$PSScriptRoot\config.ps1"
Assert-Admin
$ErrorActionPreference = 'Stop'

$isDc = (Get-CimInstance Win32_ComputerSystem).DomainRole -ge 4
if (-not $isDc) { throw 'May chua phai Domain Controller. Chay 02-install-adds.ps1 truoc.' }

Write-Step 'Cai role Active Directory Certificate Services'
if ((Get-WindowsFeature -Name AD-Certificate).Installed) {
    Write-Ok 'Role da cai'
} else {
    Install-WindowsFeature -Name AD-Certificate -IncludeManagementTools | Out-Null
    Write-Ok 'Da cai role'
}

Write-Step "Cau hinh Enterprise Root CA '$CaCommonName'"
$caConfigured = $null -ne (Get-Service -Name CertSvc -ErrorAction SilentlyContinue |
    Where-Object { $_.Status -eq 'Running' })
if ($caConfigured) {
    Write-Ok 'CA da chay'
} else {
    try {
        Install-AdcsCertificationAuthority `
            -CAType EnterpriseRootCA `
            -CACommonName $CaCommonName `
            -KeyLength 4096 `
            -HashAlgorithmName SHA256 `
            -ValidityPeriod Years `
            -ValidityPeriodUnits 10 `
            -Force | Out-Null
        Write-Ok 'Da cau hinh CA'
    } catch {
        if ($_.Exception.Message -match 'already installed|da duoc cai') {
            Write-Ok 'CA da cau hinh truoc do'
        } else {
            throw
        }
    }
}

Write-Step 'Ep DC enroll certificate tu template Domain Controller Authentication'
& certutil -pulse | Out-Null
& gpupdate /force | Out-Null

# Enrollment chạy nền, chờ tối đa 90 giây.
$cert = $null
for ($i = 0; $i -lt 18; $i++) {
    $cert = Get-ChildItem Cert:\LocalMachine\My | Where-Object {
        $_.EnhancedKeyUsageList.ObjectId -contains '1.3.6.1.5.5.7.3.1' -and
        $_.DnsNameList.Unicode -contains $DcFqdn -and
        $_.NotAfter -gt (Get-Date) -and
        $_.HasPrivateKey
    } | Sort-Object NotAfter -Descending | Select-Object -First 1
    if ($cert) { break }
    Start-Sleep -Seconds 5
    & certutil -pulse | Out-Null
}

if (-not $cert) {
    Write-Warn "Chua thay certificate hop le cho $DcFqdn trong Cert:\LocalMachine\My"
    Write-Warn 'Kiem tra thu cong: certlm.msc -> Personal -> Certificates'
    Write-Warn 'Hoac chay lai script sau vai phut (enrollment co the cham).'
    throw 'Khong tim thay certificate LDAPS.'
}
Write-Ok "Certificate: $($cert.Subject)"
Write-Ok "  Thumbprint : $($cert.Thumbprint)"
Write-Ok "  SAN        : $($cert.DnsNameList.Unicode -join ', ')"
Write-Ok "  Het han    : $($cert.NotAfter)"

Write-Step 'Restart NTDS de AD DS nhan certificate'
Restart-Service NTDS -Force
Start-Sleep -Seconds 10
Write-Ok 'Da restart'

Write-Step 'Kiem tra port 636'
$test = Test-NetConnection -ComputerName $DcFqdn -Port 636 -WarningAction SilentlyContinue
if ($test.TcpTestSucceeded) {
    Write-Ok 'Port 636 dang lang nghe'
} else {
    Write-Warn 'Port 636 chua mo. Doi them 30 giay roi kiem tra lai bang: Test-NetConnection localhost -Port 636'
}

Write-Step 'Sieet LDAP signing (chan simple bind cleartext tren port 389)'
# LDAPServerIntegrity = 2 -> yeu cau signing cho ket noi khong ma hoa.
# LDAPS (636) khong bi anh huong vi da co TLS.
$ntdsParams = 'HKLM:\SYSTEM\CurrentControlSet\Services\NTDS\Parameters'
Set-ItemProperty -Path $ntdsParams -Name 'LDAPServerIntegrity' -Value 2 -Type DWord
Write-Ok 'LDAPServerIntegrity = 2 (se co hieu luc sau restart NTDS/may)'

Write-Step "Gioi han firewall: chi $AppVpsAddress duoc vao port 636"
$ruleName = 'Campha app - LDAPS inbound'
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 636 `
    -RemoteAddress $AppVpsAddress `
    -LocalAddress $PrivateIPAddress `
    -Action Allow `
    -Profile Any | Out-Null
Write-Ok "Da tao rule: $AppVpsAddress -> $PrivateIPAddress`:636"
Write-Warn 'Rule chi ap dung tren IP private. Port 636 khong lang nghe cho card public sau khi chay 07.'

Write-Host ''
Write-Host 'Buoc tiep theo: chay 07-harden-multihomed-dc.ps1 (neu DC co card public),' -ForegroundColor Cyan
Write-Host 'sau do 05-export-ca.ps1' -ForegroundColor Cyan
