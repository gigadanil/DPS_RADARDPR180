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
    Write-Host "❌ Не найдено: $name" -ForegroundColor Red
    Write-Host "Установи Supabase CLI и перезапусти PowerShell." -ForegroundColor Yellow
    Write-Host "Проверка: supabase --version" -ForegroundColor Gray
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
Write-Host "ProjectRef: $ProjectRef" -ForegroundColor Gray

Write-Host "\n1) Supabase login (если уже логинился — можно закрыть браузер)" -ForegroundColor Cyan
try {
  supabase login | Out-Host
} catch {
  Write-Host "⚠️ supabase login не выполнился автоматически. Продолжу дальше." -ForegroundColor Yellow
}

Write-Host "\n2) Link project" -ForegroundColor Cyan
supabase link --project-ref $ProjectRef | Out-Host

Write-Host "\n3) Введи секреты (они НЕ сохраняются в репозиторий)" -ForegroundColor Cyan
$botTokenSec = Read-Host "TELEGRAM_BOT_TOKEN" -AsSecureString
$jwtSecretSec = Read-Host "JWT_SECRET (Supabase Settings → API → JWT Secret)" -AsSecureString

$botToken = (SecureToPlain $botTokenSec).Trim()
$jwtSecret = (SecureToPlain $jwtSecretSec).Trim()

if (-not $botToken) { throw "Пустой TELEGRAM_BOT_TOKEN" }
if (-not $jwtSecret) { throw "Пустой JWT_SECRET" }

Write-Host "\n4) Set secrets" -ForegroundColor Cyan
supabase secrets set TELEGRAM_BOT_TOKEN=$botToken | Out-Host
supabase secrets set JWT_SECRET=$jwtSecret | Out-Host

if (-not $SkipDeploy) {
  Write-Host "\n5) Deploy functions" -ForegroundColor Cyan
  supabase functions deploy telegram-auth | Out-Host
  supabase functions deploy telegram-login | Out-Host
}

Write-Host "\n✅ Готово." -ForegroundColor Green
Write-Host "Дальше в @BotFather нужно: /setdomain (для Login Widget) на домен сайта." -ForegroundColor Yellow
Write-Host "И проверь BOT_USERNAME в final.html (это @username бота, НЕ токен)." -ForegroundColor Yellow
