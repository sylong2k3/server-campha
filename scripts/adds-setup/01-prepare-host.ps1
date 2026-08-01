# Bước 1: cấu hình mạng cho DC multi-homed và đổi tên máy trước khi promote.
#
# Nguyên tắc với DC có 2 card:
#   - Card PRIVATE: IP tĩnh, KHÔNG default gateway, AD/DNS/LDAPS chạy ở đây.
#   - Card PUBLIC : giữ nguyên IP và gateway (để RDP/update), nhưng TẮT DNS registration
#                   để DC không quảng bá IP public vào DNS của domain.
#
# Máy sẽ khởi động lại ở cuối script nếu cần đổi tên.

. "$PSScriptRoot\config.ps1"
Assert-Admin
$ErrorActionPreference = 'Stop'

Write-Step 'Liet ke card mang hien co'
Get-NetAdapter | Format-Table Name, InterfaceDescription, Status, LinkSpeed -AutoSize
Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.InterfaceAlias -notmatch 'Loopback' } |
    Format-Table InterfaceAlias, IPAddress, PrefixLength -AutoSize

Write-Step "Kiem tra card private '$PrivateInterfaceAlias'"
$privateAdapter = Get-NetAdapter -Name $PrivateInterfaceAlias -ErrorAction SilentlyContinue
if (-not $privateAdapter) {
    throw "Khong tim thay card '$PrivateInterfaceAlias'. Sua `$PrivateInterfaceAlias trong config.ps1 theo bang o tren."
}
if ($privateAdapter.Status -ne 'Up') {
    Write-Warn "Card '$PrivateInterfaceAlias' dang o trang thai $($privateAdapter.Status)."
}
Write-Ok "Card private: $($privateAdapter.Name)"

if ($PublicInterfaceAlias) {
    $publicAdapter = Get-NetAdapter -Name $PublicInterfaceAlias -ErrorAction SilentlyContinue
    if (-not $publicAdapter) {
        throw "Khong tim thay card public '$PublicInterfaceAlias'. Sua config.ps1 hoac de trong neu chi co 1 card."
    }
    if ($PublicInterfaceAlias -eq $PrivateInterfaceAlias) {
        throw 'Card public va private khong duoc trung ten.'
    }
    Write-Ok "Card public: $($publicAdapter.Name) (khong doi IP)"
}

Write-Step "Dat IP tinh $PrivateIPAddress/$PrivatePrefixLength tren card private"
$existing = Get-NetIPAddress -InterfaceAlias $PrivateInterfaceAlias -AddressFamily IPv4 -ErrorAction SilentlyContinue
if ($existing.IPAddress -contains $PrivateIPAddress) {
    Write-Ok 'IP da dung, bo qua'
} else {
    Get-NetIPAddress -InterfaceAlias $PrivateInterfaceAlias -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Remove-NetIPAddress -Confirm:$false
    Set-NetIPInterface -InterfaceAlias $PrivateInterfaceAlias -Dhcp Disabled
    # Cố ý không truyền -DefaultGateway: DC chỉ được có một default gateway, nằm ở card public.
    New-NetIPAddress -InterfaceAlias $PrivateInterfaceAlias `
        -IPAddress $PrivateIPAddress -PrefixLength $PrivatePrefixLength | Out-Null
    Write-Ok "Da dat $PrivateIPAddress (khong gateway)"
}

Write-Step 'Kiem tra chi co mot default gateway'
$gateways = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue
if ($gateways.Count -gt 1) {
    Write-Warn 'Phat hien nhieu default gateway:'
    $gateways | Format-Table InterfaceAlias, NextHop, RouteMetric -AutoSize
    Write-Warn 'DC multi-homed chi duoc co MOT default gateway (tren card public). Go bot truoc khi promote.'
} else {
    Write-Ok "Default gateway: $($gateways.NextHop) qua $($gateways.InterfaceAlias)"
}

if ($PublicInterfaceAlias) {
    Write-Step 'Tat DNS registration tren card public'
    # Ngăn DC tự đăng ký IP public vào DNS zone của domain.
    Set-DnsClient -InterfaceAlias $PublicInterfaceAlias -RegisterThisConnectionsAddress $false
    Write-Ok 'Da tat'

    Write-Step 'Uu tien card private cho luu luong noi bo'
    # Metric thấp hơn => Windows ưu tiên card private khi cùng tới đích trong private network.
    Set-NetIPInterface -InterfaceAlias $PrivateInterfaceAlias -InterfaceMetric 10
    Set-NetIPInterface -InterfaceAlias $PublicInterfaceAlias -InterfaceMetric 20
    Write-Ok 'Private metric 10, public metric 20'
}

Write-Step "Dat DNS tam thoi $UpstreamDns (Install-ADDSForest se tu tro ve chinh no)"
Set-DnsClientServerAddress -InterfaceAlias $PrivateInterfaceAlias -ServerAddresses $UpstreamDns
Write-Ok 'Xong'

Write-Step "Doi ten may thanh $ServerName"
if ($env:COMPUTERNAME -eq $ServerName) {
    Write-Ok 'Ten may da dung, khong can restart'
    Write-Host ''
    Write-Host 'Buoc tiep theo: chay 02-install-adds.ps1' -ForegroundColor Cyan
    return
}

Rename-Computer -NewName $ServerName -Force
Write-Ok 'Da doi ten, may se restart trong 10 giay'
Write-Host ''
Write-Host 'Sau khi restart, chay 02-install-adds.ps1' -ForegroundColor Cyan
Start-Sleep -Seconds 10
Restart-Computer -Force
