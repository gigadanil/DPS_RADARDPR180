Param(
  [Parameter(Mandatory=$true)]
  [string]$ProjectRef,

  [Parameter(Mandatory=$false)]
  [switch]$SkipDeploy
)

$ErrorActionPreference = 'Stop'

function Require-Command($name) {
  $cmd = Get-Command $name -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Host ("ERROR: command not found: {0}" -f $name) -ForegroundColor Red
    Write-Host "Install Supabase CLI and restart PowerShell." -ForegroundColor Yellow
    Write-Host "Check: supabase --version" -ForegroundColor Gray
    exit 1
  }
}

function SecureToPlain([Security.SecureString]$sec) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

Require-Command supabase

Write-Host "== SafeDrive 180: Telegram Auth setup ==" -ForegroundColor Cyan
Write-Host ("ProjectRef: {0}" -f $ProjectRef) -ForegroundColor Gray

Write-Host ""
Write-Host "1) Supabase login (if already logged in, you can close the browser)" -ForegroundColor Cyan
try {
  supabase login | Out-Host
} catch {
  Write-Host "WARN: supabase login did not run automatically. Continue..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "2) Link project" -ForegroundColor Cyan
supabase link --project-ref $ProjectRef | Out-Host

Write-Host ""
Write-Host "3) Enter secrets (they are NOT saved into the repository)" -ForegroundColor Cyan
$botTokenSec = Read-Host "TELEGRAM_BOT_TOKEN" -AsSecureString
$serviceRoleSec = Read-Host "SERVICE_ROLE_KEY (Supabase Settings -> API -> service_role key)" -AsSecureString

$botToken = (SecureToPlain $botTokenSec).Trim()
$serviceRole = (SecureToPlain $serviceRoleSec).Trim()

if (-not $botToken) { throw "Empty TELEGRAM_BOT_TOKEN" }
if (-not $serviceRole) { throw "Empty SERVICE_ROLE_KEY" }

Write-Host ""
Write-Host "4) Set secrets" -ForegroundColor Cyan
supabase secrets set TELEGRAM_BOT_TOKEN=$botToken | Out-Host
supabase secrets set SERVICE_ROLE_KEY=$serviceRole | Out-Host

if (-not $SkipDeploy) {
  Write-Host ""
  Write-Host "5) Deploy functions" -ForegroundColor Cyan
  supabase functions deploy telegram-auth | Out-Host
  supabase functions deploy telegram-login | Out-Host
}

Write-Host ""
Write-Host "DONE." -ForegroundColor Green
Write-Host "Next in @BotFather: /setdomain (for Login Widget) to your site domain." -ForegroundColor Yellow
Write-Host "Also check BOT_USERNAME in final.html (this is @botusername, NOT the token)." -ForegroundColor Yellow
