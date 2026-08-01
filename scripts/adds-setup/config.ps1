# Cấu hình chung cho toàn bộ script dựng AD DS.
# Sửa các giá trị dưới đây TRƯỚC KHI chạy bất kỳ script nào.
# Tên domain và NetBIOS không đổi được sau khi promote.

# --- Danh tính domain ---
$DomainName  = 'ad.campha.vn'   # FQDN của forest mới
$NetbiosName = 'CAMPHA'         # <= 15 ký tự, không dấu, viết hoa
$ServerName  = 'DC01'           # Tên máy DC, đặt trước khi promote

# --- Mạng: card PRIVATE (AD, DNS, LDAPS chạy trên card này) ---
# Đây là card nối tới VPS app qua private network của nhà cung cấp.
# KHÔNG đặt default gateway trên card private.
$PrivateInterfaceAlias = 'Ethernet 2'
$PrivateIPAddress      = '10.104.0.10'
$PrivatePrefixLength   = 20
$PrivateSubnet         = '10.104.0.0/20'   # dải private của nhà cung cấp, dùng cho firewall

# --- Mạng: card PUBLIC (chỉ để RDP và Windows Update) ---
# Để trống nếu server chỉ có một card. Script sẽ không đổi IP card này,
# chỉ tắt DNS registration và siết firewall trên nó.
$PublicInterfaceAlias = 'Ethernet'

$UpstreamDns = '8.8.8.8'   # DNS tạm dùng trước khi promote

# IP PRIVATE của VPS chạy server-campha — đây là IP duy nhất được vào port 636.
$AppVpsAddress = '10.104.0.20'

# Danh sách IP được phép RDP/WinRM vào card public.
# Điền sai sẽ tự khoá mình khỏi server — kiểm tra kỹ IP hiện tại của bạn trước khi chạy 07.
$AdminAllowList = @()      # vd: @('113.161.10.20/32')

# --- Cấu trúc directory ---
$OuName             = 'Campha'
$ServiceAccountName = 'svc_campha_ldap'
$CaCommonName       = 'Campha-Root-CA'

# --- Đường dẫn xuất file ---
$ExportPath = 'C:\campha-ldap'

# --- Giá trị dẫn xuất, không sửa ---
$DomainDN     = ($DomainName -split '\.' | ForEach-Object { "DC=$_" }) -join ','
$OuDN         = "OU=$OuName,$DomainDN"
$UsersOuDN    = "OU=Users,$OuDN"
$ServiceOuDN  = "OU=ServiceAccounts,$OuDN"
$DcFqdn       = "$ServerName.$DomainName".ToLower()
$ServiceUpn   = "$ServiceAccountName@$DomainName"

function Assert-Admin {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Script phải chạy trong PowerShell mở bằng Run as Administrator.'
    }
}

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Message)
    Write-Host "    OK: $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "    CANH BAO: $Message" -ForegroundColor Yellow
}
