# Bước 6: mô phỏng đúng luồng mà src/services/ldap.service.js thực hiện,
# để xác nhận hạ tầng sẵn sàng trước khi bật LDAP_ENABLED=true trên VPS.
#
#   1. Simple bind bằng service account qua LDAPS (như withServiceClient)
#   2. Search subtree filter (&(objectClass=user)(sAMAccountName=<user>)) (như findByLogin)
#   3. Simple bind bằng DN của user với password người dùng (như verifyPassword)

. "$PSScriptRoot\config.ps1"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.DirectoryServices.Protocols

$targetHost = Read-Host "Hostname DC de ket noi (Enter = $DcFqdn)"
if ([string]::IsNullOrWhiteSpace($targetHost)) { $targetHost = $DcFqdn }

$searchBase = Read-Host "Base DN (Enter = $OuDN)"
if ([string]::IsNullOrWhiteSpace($searchBase)) { $searchBase = $OuDN }

function New-LdapsConnection {
    param([string]$ComputerName)

    $identifier = New-Object System.DirectoryServices.Protocols.LdapDirectoryIdentifier($ComputerName, 636)
    $connection = New-Object System.DirectoryServices.Protocols.LdapConnection($identifier)
    $connection.AuthType = [System.DirectoryServices.Protocols.AuthType]::Basic
    $connection.SessionOptions.ProtocolVersion = 3
    $connection.SessionOptions.SecureSocketLayer = $true
    $connection.Timeout = [TimeSpan]::FromSeconds(10)
    # Chỉ báo cáo kết quả validate, không bỏ qua lỗi cert.
    $connection.SessionOptions.VerifyServerCertificate = {
        param($conn, $cert)
        $script:ServerCertSubject = $cert.Subject
        return $true
    }
    return $connection
}

Write-Step "1/3 Bind service account $ServiceUpn qua ldaps://$targetHost`:636"
$bindPassword = Read-Host -AsSecureString "Password cua $ServiceAccountName"
$plainBind = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($bindPassword))

$serviceConn = New-LdapsConnection -ComputerName $targetHost
try {
    $serviceConn.Credential = New-Object System.Net.NetworkCredential($ServiceUpn, $plainBind)
    $serviceConn.Bind()
    Write-Ok 'Service bind thanh cong'
    Write-Ok "Certificate server: $script:ServerCertSubject"
} catch {
    Write-Host "    THAT BAI: $($_.Exception.Message)" -ForegroundColor Red
    Write-Warn 'Kiem tra: port 636 mo chua, cert co SAN dung hostname chua, password service account dung chua.'
    throw
} finally {
    $plainBind = $null
}

Write-Step '2/3 Search user theo sAMAccountName'
$sam = Read-Host 'sAMAccountName cua user test'
$escaped = $sam -replace '([\\*()\x00])', '\$1'
$filter = "(&(objectClass=user)(sAMAccountName=$escaped))"

$request = New-Object System.DirectoryServices.Protocols.SearchRequest(
    $searchBase,
    $filter,
    [System.DirectoryServices.Protocols.SearchScope]::Subtree,
    @('sAMAccountName', 'objectGUID', 'mail', 'displayName', 'userAccountControl', 'accountExpires')
)

$response = $serviceConn.SendRequest($request)
if ($response.Entries.Count -ne 1) {
    Write-Host "    THAT BAI: tim thay $($response.Entries.Count) entry, mong doi dung 1" -ForegroundColor Red
    Write-Warn "App yeu cau dung 1 ket qua. Kiem tra lai Base DN: $searchBase"
    throw 'Search khong tra ve dung 1 entry.'
}

$entry = $response.Entries[0]
$userDn = $entry.DistinguishedName
$uac    = [int]$entry.Attributes['userAccountControl'][0]
$guid   = ([byte[]]$entry.Attributes['objectGUID'][0] | ForEach-Object { $_.ToString('x2') }) -join ''

Write-Ok "DN             : $userDn"
Write-Ok "sAMAccountName : $($entry.Attributes['sAMAccountName'][0])"
Write-Ok "displayName    : $(if ($entry.Attributes['displayName']) { $entry.Attributes['displayName'][0] } else { '(trong)' })"
Write-Ok "mail           : $(if ($entry.Attributes['mail']) { $entry.Attributes['mail'][0] } else { '(trong)' })"
Write-Ok "objectGUID hex : $guid"

if (-not $entry.Attributes['mail']) {
    Write-Warn 'Thieu mail. App dung email lam khoa provision, phai dien truoc khi UAT.'
}
if (-not $entry.Attributes['displayName']) {
    Write-Warn 'Thieu displayName. App se fallback ve sAMAccountName lam fullName.'
}
if (($uac -band 0x0002) -ne 0) {
    Write-Warn 'Account dang bi disable, app se tu choi dang nhap (dung thiet ke).'
}

$serviceConn.Dispose()

Write-Step '3/3 Bind bang DN cua user (kiem tra password nguoi dung)'
$doUserBind = Read-Host 'Thu bind bang password user test? (y/N)'
if ($doUserBind -ne 'y') {
    Write-Host ''
    Write-Host 'Bo qua buoc 3. Ha tang LDAPS da san sang o muc service bind + search.' -ForegroundColor Cyan
    return
}

$userPassword = Read-Host -AsSecureString "Password cua $sam"
$plainUser = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($userPassword))

$userConn = New-LdapsConnection -ComputerName $targetHost
try {
    $userConn.Credential = New-Object System.Net.NetworkCredential($userDn, $plainUser)
    $userConn.Bind()
    Write-Ok 'User bind thanh cong'
} catch {
    Write-Host "    THAT BAI: $($_.Exception.Message)" -ForegroundColor Red
    throw
} finally {
    $plainUser = $null
    $userConn.Dispose()
}

Write-Host ''
Write-Host 'Ha tang AD DS + LDAPS da san sang.' -ForegroundColor Green
Write-Host 'Tiep theo tren VPS:' -ForegroundColor Cyan
Write-Host '  1. Copy ad-ca.pem -> /etc/campha/certs/ad-ca.pem (mode 0640)'
Write-Host '  2. Ghi bind password -> /etc/campha/secrets/ldap-bind-password (mode 0600)'
Write-Host '  3. Cap nhat .env theo ldap.env.snippet, GIU LDAP_ENABLED=false'
Write-Host '  4. Chay UAT trong docs/LDAP_AD_RUNBOOK.md roi moi bat flag'
