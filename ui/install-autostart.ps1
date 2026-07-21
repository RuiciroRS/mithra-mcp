# Mithra UI - registers the scheduled task that starts the server at logon.
# Reversible: run uninstall-autostart.ps1 to remove it.
# Trigger: AtLogOn for the current user (no password prompt, never runs headless).
$ErrorActionPreference = 'Stop'

$taskName = 'Mithra UI'
$dir      = Split-Path -Parent $MyInvocation.MyCommand.Path   # this repo, wherever you cloned it
$vbs      = Join-Path $dir 'mithra-autostart.vbs'

if (-not (Test-Path $vbs)) { throw "Launcher not found: $vbs" }

$action  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`"" -WorkingDirectory $dir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
# No time limit (the server runs indefinitely); starts even if the trigger is late.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Force `
  -Description 'Starts the Mithra UI server (node server.js, no window) at logon.' | Out-Null

Write-Host "OK - task '$taskName' registered (starts at logon)." -ForegroundColor Green
