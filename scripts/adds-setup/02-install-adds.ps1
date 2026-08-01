# Bước 2: cài role AD DS và tạo forest mới. Máy sẽ tự khởi động lại ở cuối.

. "$PSScriptRoot\config.ps1"
Assert-Admin
$ErrorActionPreference = 'Stop'

if ($env:COMPUTERNAME -ne $ServerName) {
    throw "Ten may hien tai la '$env:COMPUTERNAME', mong doi '$ServerName'. Chay 01-prepare-host.ps1 truoc."
}

Write-Step 'Cai role Active Directory Domain Services'
$feature = Get-WindowsFeature -Name AD-Domain-Services
if ($feature.Installed) {
    Write-Ok 'Role da cai'
} else {
    Install-WindowsFeature -Name AD-Domain-Services -IncludeManagementTools | Out-Null
    Write-Ok 'Da cai role'
}

Write-Step 'Kiem tra may da la Domain Controller chua'
$isDc = (Get-CimInstance Win32_ComputerSystem).DomainRole -ge 4
if ($isDc) {
    Write-Ok "May da la DC cua domain $((Get-CimInstance Win32_ComputerSystem).Domain)"
    Write-Host ''
    Write-Host 'Buoc tiep theo: chay 03-create-objects.ps1' -ForegroundColor Cyan
    return
}

Write-Host ''
Write-Host "Sap tao forest moi:" -ForegroundColor Yellow
Write-Host "  Domain   : $DomainName"
Write-Host "  NetBIOS  : $NetbiosName"
Write-Host "  Base DN  : $DomainDN"
Write-Host "  DC FQDN  : $DcFqdn"
Write-Host ''
$confirm = Read-Host 'Xac nhan tao forest? Go YES de tiep tuc'
if ($confirm -ne 'YES') { throw 'Da huy.' }

# DSRM password chỉ dùng khi boot vào Directory Services Restore Mode.
# Lưu vào password manager của đơn vị, không ghi ra file hay Git.
Write-Host ''
Write-Host 'Nhap DSRM password (luu vao password manager, KHONG ghi ra file):' -ForegroundColor Yellow
$dsrmPassword = Read-Host -AsSecureString 'DSRM password'
$dsrmConfirm  = Read-Host -AsSecureString 'Nhap lai'

$plain1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($dsrmPassword))
$plain2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($dsrmConfirm))
if ($plain1 -ne $plain2) { throw 'Hai lan nhap khong khop.' }
if ($plain1.Length -lt 12) { throw 'DSRM password phai it nhat 12 ky tu.' }
$plain1 = $null; $plain2 = $null

Write-Step 'Tao forest (may se restart khi xong)'
Install-ADDSForest `
    -DomainName $DomainName `
    -DomainNetbiosName $NetbiosName `
    -ForestMode 'WinThreshold' `
    -DomainMode 'WinThreshold' `
    -SafeModeAdministratorPassword $dsrmPassword `
    -InstallDns `
    -DatabasePath 'C:\Windows\NTDS' `
    -LogPath 'C:\Windows\NTDS' `
    -SysvolPath 'C:\Windows\SYSVOL' `
    -NoRebootOnCompletion:$false `
    -Force
