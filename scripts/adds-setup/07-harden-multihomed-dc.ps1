# Bước 7: siết DC multi-homed sao cho toàn bộ dịch vụ AD chỉ sống trên card private,
# card public chỉ còn RDP từ IP quản trị.
#
# Chạy sau 04, trước 05. Bỏ qua nếu server chỉ có một card private thuần tuý.
#
# Việc script làm:
#   1. Gỡ record DNS trỏ về IP public trong zone của domain
#   2. Ép DNS server chỉ lắng nghe trên IP private
#   3. Thu hẹp mọi inbound allow rule về private subnet + IP quản trị
#   4. Chặn dứt điểm các port AD từ Internet
#
# CẢNH BÁO: điền sai $AdminAllowList sẽ khoá bạn khỏi RDP.
# Mở sẵn console/VNC của nhà cung cấp trước khi chạy.

. "$PSScriptRoot\config.ps1"
Assert-Admin
$ErrorActionPreference = 'Stop'

if (-not $PublicInterfaceAlias) {
    Write-Ok 'Khong khai bao card public, khong can chay script nay.'
    return
}
if (-not $AdminAllowList -or $AdminAllowList.Count -eq 0) {
    throw 'Phai dien $AdminAllowList trong config.ps1 truoc khi chay script nay.'
}

$publicIps = (Get-NetIPAddress -InterfaceAlias $PublicInterfaceAlias -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress
if (-not $publicIps) { throw "Khong doc duoc IP cua card '$PublicInterfaceAlias'." }

Write-Host ''
Write-Host 'Cau hinh se ap dung:' -ForegroundColor Yellow
Write-Host "  Card private : $PrivateInterfaceAlias / $PrivateIPAddress  (AD, DNS, LDAPS)"
Write-Host "  Card public  : $PublicInterfaceAlias / $($publicIps -join ', ')  (chi RDP)"
Write-Host "  Private subnet: $PrivateSubnet"
Write-Host "  RDP cho phep  : $($AdminAllowList -join ', ')"
Write-Host ''

$currentClient = (Get-NetTCPConnection -LocalPort 3389 -State Established -ErrorAction SilentlyContinue |
    Select-Object -First 1).RemoteAddress
if ($currentClient) {
    Write-Host "IP dang RDP vao server: $currentClient" -ForegroundColor Yellow
    $covered = $AdminAllowList | Where-Object { $currentClient -like ($_ -replace '/\d+$', '*') }
    if (-not $covered) {
        Write-Warn 'IP nay KHONG nam trong $AdminAllowList. Chay tiep se mat ket noi RDP.'
    } else {
        Write-Ok 'IP nay nam trong allowlist'
    }
}

Write-Host ''
$confirm = Read-Host 'Xac nhan siet cau hinh? Go YES de tiep tuc'
if ($confirm -ne 'YES') { throw 'Da huy.' }

Write-Step 'Sao luu cau hinh firewall'
if (-not (Test-Path $ExportPath)) { New-Item -ItemType Directory -Path $ExportPath | Out-Null }
$backupPath = Join-Path $ExportPath ("firewall-backup-{0}.wfw" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
& netsh advfirewall export $backupPath | Out-Null
Write-Ok "Backup: $backupPath"
Write-Warn "Khoi phuc bang: netsh advfirewall import `"$backupPath`""

Write-Step 'Go record DNS tro ve IP public trong zone domain'
# DC tu dang ky ca hai IP vao zone; client se random chon va co the ra IP public.
foreach ($publicIp in $publicIps) {
    $stale = Get-DnsServerResourceRecord -ZoneName $DomainName -RRType A -ErrorAction SilentlyContinue |
        Where-Object { $_.RecordData.IPv4Address.IPAddressToString -eq $publicIp }
    foreach ($record in $stale) {
        Remove-DnsServerResourceRecord -ZoneName $DomainName -RRType A `
            -Name $record.HostName -RecordData $publicIp -Force
        Write-Ok "Da go: $($record.HostName) -> $publicIp"
    }
}
$remaining = Get-DnsServerResourceRecord -ZoneName $DomainName -RRType A -ErrorAction SilentlyContinue
Write-Ok 'Record A con lai trong zone:'
$remaining | ForEach-Object {
    Write-Host "      $($_.HostName) -> $($_.RecordData.IPv4Address.IPAddressToString)"
}

Write-Step 'Ep DNS server chi lang nghe tren IP private'
& dnscmd /ResetListenAddresses $PrivateIPAddress | Out-Null
Restart-Service DNS -Force
Start-Sleep -Seconds 5
Write-Ok "DNS server chi lang nghe $PrivateIPAddress"

Write-Step 'Thu hep pham vi cac inbound allow rule ve private subnet'
$trusted = @($PrivateSubnet, 'LocalSubnet')
$rules = Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True
$changed = 0
foreach ($rule in $rules) {
    if (($rule | Get-NetFirewallAddressFilter).RemoteAddress -eq 'Any') {
        Set-NetFirewallRule -Name $rule.Name -RemoteAddress $trusted
        $changed++
    }
}
Write-Ok "Da thu hep $changed / $($rules.Count) rule"

Write-Step 'Mo lai RDP cho IP quan tri tren card public'
$rdpRule = 'Campha - RDP admin only'
Get-NetFirewallRule -DisplayName $rdpRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule `
    -DisplayName $rdpRule `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 3389 `
    -RemoteAddress $AdminAllowList `
    -Action Allow `
    -Profile Any | Out-Null
Write-Ok "RDP mo cho: $($AdminAllowList -join ', ')"

Write-Step 'Chan dut diem cac port AD tu Internet'
$blockRule = 'Campha - Block AD ports from Internet'
Get-NetFirewallRule -DisplayName $blockRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule `
    -DisplayName $blockRule `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort 53, 88, 135, 139, 389, 445, 464, 636, 3268, 3269, 9389 `
    -RemoteAddress Internet `
    -Action Block `
    -Profile Any | Out-Null

$blockUdpRule = 'Campha - Block AD UDP ports from Internet'
Get-NetFirewallRule -DisplayName $blockUdpRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule `
    -DisplayName $blockUdpRule `
    -Direction Inbound `
    -Protocol UDP `
    -LocalPort 53, 88, 123, 137, 138, 389, 464 `
    -RemoteAddress Internet `
    -Action Block `
    -Profile Any | Out-Null
Write-Ok 'Da chan TCP + UDP'

Write-Host ''
Write-Step 'Kiem tra lai'
Write-Host '  Rule con mo cho moi dia chi:'
$open = Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True |
    Where-Object { ($_ | Get-NetFirewallAddressFilter).RemoteAddress -eq 'Any' }
if ($open) {
    $open | Select-Object DisplayName | Format-Table -AutoSize
} else {
    Write-Ok 'Khong con rule nao mo cho moi dia chi'
}

Write-Host '  Port dang lang nghe tren IP public:'
$listening = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $publicIps -contains $_.LocalAddress } |
    Select-Object -ExpandProperty LocalPort | Sort-Object -Unique
if ($listening) {
    Write-Host "      $($listening -join ', ')"
    Write-Warn 'Cac port nay van lang nghe nhung da bi firewall chan tu Internet.'
} else {
    Write-Ok 'Khong co port nao bind rieng vao IP public'
}

Write-Host ''
Write-Warn 'TRUOC KHI DONG PHIEN NAY: mo mot phien RDP moi de xac nhan van vao duoc.'
Write-Warn "Neu mat ket noi, dung console/VNC va chay: netsh advfirewall import `"$backupPath`""
Write-Host ''
Write-Host 'Buoc tiep theo: chay 05-export-ca.ps1' -ForegroundColor Cyan
