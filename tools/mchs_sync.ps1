param(
  [string]$ProjectRef = "phazbjchjhsruwalddis",
  [string]$SupabaseBase = "https://phazbjchjhsruwalddis.supabase.co/functions/v1/mchs-auto",
  [string]$CronSecret = "safedrive_mchs_cron_2026_secure_token_180_dpr"
)

$ErrorActionPreference = "Stop"

# Ensure UTF-8 everywhere (important for Cyrillic RSS).
try {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [Console]::OutputEncoding = $utf8NoBom
  $OutputEncoding = $utf8NoBom
} catch {}

# Open-Meteo: cron endpoint does sync + send + mark sent
Write-Host "Syncing weather + sending to Telegram..."
$cronUrl = "$SupabaseBase?action=cron"
$cronResp = curl.exe -sS --max-time 30 -X GET "$cronUrl" -H "x-cron-secret: $CronSecret" -H "accept: application/json"
Write-Host $cronResp
