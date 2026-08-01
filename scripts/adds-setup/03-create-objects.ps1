# Bước 3: tạo OU, service account read-only và user test.
# Chạy sau khi máy đã là Domain Controller.

. "$PSScriptRoot\config.ps1"
Assert-Admin
$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory

$isDc = (Get-CimInstance Win32_ComputerSystem).DomainRole -ge 4
if (-not $isDc) { throw 'May chua phai Domain Controller. Chay 02-install-adds.ps1 truoc.' }

Write-Step 'Tro DNS client ve chinh DC (qua IP private)'
# DC phai tu phan giai qua chinh no, uu tien IP private de khong dung card public.
Set-DnsClientServerAddress -InterfaceAlias $PrivateInterfaceAlias `
    -ServerAddresses @($PrivateIPAddress, '127.0.0.1')
if ($PublicInterfaceAlias) {
    Set-DnsClientServerAddress -InterfaceAlias $PublicInterfaceAlias -ServerAddresses $PrivateIPAddress
}
Write-Ok "DNS client -> $PrivateIPAddress"

Write-Step 'Dat DNS forwarder de DC van phan giai duoc Internet'
try {
    Set-DnsServerForwarder -IPAddress $UpstreamDns -UseRootHint $true -ErrorAction Stop
    Write-Ok "Forwarder: $UpstreamDns"
} catch {
    Write-Warn "Khong dat duoc forwarder: $($_.Exception.Message)"
}

function New-OuIfMissing {
    param([string]$Name, [string]$Path)
    $dn = "OU=$Name,$Path"
    if (Get-ADOrganizationalUnit -Filter "DistinguishedName -eq '$dn'" -ErrorAction SilentlyContinue) {
        Write-Ok "OU da ton tai: $dn"
    } else {
        New-ADOrganizationalUnit -Name $Name -Path $Path -ProtectedFromAccidentalDeletion $true
        Write-Ok "Da tao OU: $dn"
    }
}

Write-Step 'Tao cau truc OU'
New-OuIfMissing -Name $OuName -Path $DomainDN
New-OuIfMissing -Name 'Users' -Path $OuDN
New-OuIfMissing -Name 'ServiceAccounts' -Path $OuDN

Write-Step "Tao service account $ServiceAccountName"
$existingSvc = Get-ADUser -Filter "SamAccountName -eq '$ServiceAccountName'" -ErrorAction SilentlyContinue
if ($existingSvc) {
    Write-Ok "Da ton tai: $($existingSvc.DistinguishedName)"
} else {
    Write-Host ''
    Write-Host 'Nhap password cho service account.' -ForegroundColor Yellow
    Write-Host 'Password nay se ghi vao /etc/campha/secrets/ldap-bind-password tren VPS.' -ForegroundColor Yellow
    $svcPassword = Read-Host -AsSecureString "Password cho $ServiceAccountName"

    New-ADUser `
        -Name $ServiceAccountName `
        -SamAccountName $ServiceAccountName `
        -UserPrincipalName $ServiceUpn `
        -DisplayName 'Campha LDAP Service Account' `
        -Description 'Bind account read-only cho server-campha. Khong dung dang nhap tuong tac.' `
        -Path $ServiceOuDN `
        -AccountPassword $svcPassword `
        -Enabled $true `
        -PasswordNeverExpires $true `
        -CannotChangePassword $true
    Write-Ok "Da tao $ServiceUpn"
}

# Service account chỉ cần quyền đọc mặc định của Authenticated Users.
# Không thêm vào group đặc quyền nào; đặc biệt không Domain Admins.
Write-Step 'Kiem tra service account khong thuoc group dac quyen'
$privileged = @('Domain Admins', 'Enterprise Admins', 'Schema Admins', 'Administrators', 'Account Operators')
$memberOf = Get-ADPrincipalGroupMembership -Identity $ServiceAccountName | Select-Object -ExpandProperty Name
$bad = $memberOf | Where-Object { $privileged -contains $_ }
if ($bad) {
    Write-Warn "Service account dang thuoc group dac quyen: $($bad -join ', '). Phai go ra."
} else {
    Write-Ok "Chi thuoc: $($memberOf -join ', ')"
}

Write-Step 'Tao user test (bo qua neu khong can)'
$createTest = Read-Host 'Tao user test de chay UAT? (y/N)'
if ($createTest -eq 'y') {
    $testSam = Read-Host 'sAMAccountName (vd: nvana)'
    if (Get-ADUser -Filter "SamAccountName -eq '$testSam'" -ErrorAction SilentlyContinue) {
        Write-Ok 'User da ton tai'
    } else {
        $testDisplay = Read-Host 'displayName (vd: Nguyen Van A)'
        $testMail    = Read-Host 'mail (vd: nvana@campha.vn)'
        $testPassword = Read-Host -AsSecureString 'Password'

        New-ADUser `
            -Name $testDisplay `
            -SamAccountName $testSam `
            -UserPrincipalName "$testSam@$DomainName" `
            -DisplayName $testDisplay `
            -EmailAddress $testMail `
            -Path $UsersOuDN `
            -AccountPassword $testPassword `
            -Enabled $true `
            -ChangePasswordAtLogon $false
        Write-Ok "Da tao $testSam"
    }
}

Write-Host ''
Write-Step 'Xac nhan thuoc tinh app can doc'
Get-ADUser -SearchBase $OuDN -Filter * -Properties sAMAccountName, objectGUID, mail, displayName |
    Format-Table sAMAccountName, displayName, mail, objectGUID -AutoSize

Write-Host ''
Write-Host "LDAP_BASE_DN se la: $OuDN" -ForegroundColor Cyan
Write-Host "LDAP_BIND_DN se la: $ServiceUpn" -ForegroundColor Cyan
Write-Host 'Buoc tiep theo: chay 04-enable-ldaps.ps1' -ForegroundColor Cyan
