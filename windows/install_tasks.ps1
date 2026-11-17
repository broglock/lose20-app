# Registers the Lose20 nag as four daily scheduled tasks for the current user.
# Run from this folder in PowerShell:  .\install_tasks.ps1
# Remove them later with:              .\install_tasks.ps1 -Remove
param(
  [switch]$Remove,
  [string]$Morning = "07:30",
  [string]$Midday  = "12:15",
  [string]$Evening = "17:15",
  [string]$Night   = "20:30"
)

$ErrorActionPreference = "Stop"
$here  = Split-Path -Parent $MyInvocation.MyCommand.Path
$slots = @{ morning = $Morning; midday = $Midday; evening = $Evening; night = $Night }

if ($Remove) {
  foreach ($s in $slots.Keys) { Unregister-ScheduledTask -TaskName "Lose20 $s" -Confirm:$false -ErrorAction SilentlyContinue }
  Write-Host "Lose20 tasks removed."
  return
}

# pythonw runs without a console window.
$py = (Get-Command pythonw.exe -ErrorAction SilentlyContinue).Source
if (-not $py) {
  $py = (Get-Command python.exe -ErrorAction Stop).Source -replace 'python\.exe$', 'pythonw.exe'
}
if (-not (Test-Path $py)) { throw "pythonw.exe not found. Install Python 3 from python.org first." }
if (-not (Test-Path "$here\config.json")) { throw "Copy config.example.json to config.json and fill it in first." }

foreach ($s in $slots.Keys) {
  $action   = New-ScheduledTaskAction -Execute $py -Argument "`"$here\nag.py`" --slot $s" -WorkingDirectory $here
  $trigger  = New-ScheduledTaskTrigger -Daily -At $slots[$s]
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
  Register-ScheduledTask -TaskName "Lose20 $s" -Action $action -Trigger $trigger -Settings $settings `
    -Description "Lose20: Maya's $s check-in" -Force | Out-Null
  Write-Host ("Lose20 {0,-8} {1}" -f $s, $slots[$s])
}

# Lock config.json (it holds API keys) to the current user only.
icacls "$here\config.json" /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
Write-Host "Done. Test now with:  python `"$here\nag.py`" --slot evening"
