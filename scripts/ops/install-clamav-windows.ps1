[CmdletBinding()]
param(
    [string]$ClamAvBin = 'C:\Program Files\ClamAV',
    [ValidateRange(1, 65535)]
    [int]$Port = 3310
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtimeDir = Join-Path $projectRoot '.runtime\clamav'
$databaseDir = Join-Path $runtimeDir 'database'
$logsDir = Join-Path $runtimeDir 'logs'
$clamdExe = Join-Path $ClamAvBin 'clamd.exe'
$freshclamExe = Join-Path $ClamAvBin 'freshclam.exe'
$clamdscanExe = Join-Path $ClamAvBin 'clamdscan.exe'
$clamdConf = Join-Path $runtimeDir 'clamd.conf'
$freshclamConf = Join-Path $runtimeDir 'freshclam.conf'

foreach ($exe in @($clamdExe, $freshclamExe, $clamdscanExe)) {
    if (-not (Test-Path $exe -PathType Leaf)) {
        throw "Không tìm thấy $exe. Cài ClamAV for Windows trước."
    }
}
New-Item -ItemType Directory -Force -Path $databaseDir, $logsDir | Out-Null
$clamdLog = (Join-Path $logsDir 'clamd.log').Replace('\', '/')
$freshclamLog = (Join-Path $logsDir 'freshclam.log').Replace('\', '/')
$databasePath = $databaseDir.Replace('\', '/')

@"
LogFile $clamdLog
LogTime yes
DatabaseDirectory $databasePath
TCPSocket $Port
TCPAddr 127.0.0.1
MaxConnectionQueueLength 20
MaxThreads 10
ReadTimeout 120
CommandReadTimeout 30
SendBufTimeout 200
StreamMaxLength 2147483648
Foreground yes
"@ | Set-Content -Encoding ascii $clamdConf

@"
DatabaseDirectory $databasePath
UpdateLogFile $freshclamLog
LogTime yes
DatabaseMirror database.clamav.net
Checks 12
Foreground yes
"@ | Set-Content -Encoding ascii $freshclamConf

# Update trước khi chạy daemon. Signature cũ vẫn dùng được nếu mirror tạm lỗi.
& $freshclamExe --config-file=$freshclamConf
if ($LASTEXITCODE -ne 0 -and -not (Get-ChildItem $databaseDir -Include '*.cvd', '*.cld' -File -ErrorAction SilentlyContinue)) {
    throw "freshclam thất bại và chưa có signature database. Xem $freshclamLog"
}

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Days 0)
$clamdAction = New-ScheduledTaskAction -Execute $clamdExe -Argument "--config-file=`"$clamdConf`" --foreground"
$clamdTrigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName 'CamPha-ClamD' -Action $clamdAction -Trigger $clamdTrigger -Settings $settings -Description 'Cam Pha ClamAV daemon on 127.0.0.1' -User 'SYSTEM' -RunLevel Highest -Force | Out-Null

$freshAction = New-ScheduledTaskAction -Execute $freshclamExe -Argument "--config-file=`"$freshclamConf`" --daemon-notify=`"$clamdConf`""
$freshTrigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName 'CamPha-FreshClam' -Action $freshAction -Trigger $freshTrigger -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable) -Description 'Cam Pha ClamAV signature update' -User 'SYSTEM' -RunLevel Highest -Force | Out-Null

Get-Process clamd -ErrorAction SilentlyContinue | Stop-Process -Force
Start-ScheduledTask -TaskName 'CamPha-ClamD'
$deadline = (Get-Date).AddSeconds(90)
do {
    Start-Sleep -Seconds 2
    & $clamdscanExe --config-file=$clamdConf --ping 1 2>$null
    $ready = $LASTEXITCODE -eq 0
} until ($ready -or (Get-Date) -ge $deadline)
if (-not $ready) {
    throw "clamd không trả PONG trong 90 giây. Xem $clamdLog"
}

Write-Host "ClamAV sẵn sàng: 127.0.0.1:$Port"
Write-Host 'Đặt CLAMAV_ENABLED=true, CLAMAV_HOST=127.0.0.1 và CLAMAV_PORT tương ứng trong .env production.'
Get-ScheduledTask -TaskName 'CamPha-ClamD', 'CamPha-FreshClam' | Select-Object TaskName, State
