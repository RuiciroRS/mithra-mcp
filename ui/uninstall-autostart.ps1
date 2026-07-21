# Mithra UI - removes the autostart scheduled task (reverts install-autostart.ps1).
$ErrorActionPreference = 'Stop'
$taskName = 'Mithra UI'

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "OK - task '$taskName' removed." -ForegroundColor Yellow
} else {
  Write-Host "No task named '$taskName' was registered." -ForegroundColor DarkGray
}
