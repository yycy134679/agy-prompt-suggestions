param(
  [ValidateSet('Install', 'Uninstall')][string]$Mode = 'Install',
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
)
$ErrorActionPreference = 'Stop'
$candidates = @()
$nodeCmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
if ($nodeCmd) { $candidates += $nodeCmd.Source }
$appData = [Environment]::GetFolderPath('ApplicationData')
$candidates += (Join-Path $appData 'Antigravity/bin/agy-node.cmd')

$runtime = $null
foreach ($cand in $candidates) {
  if (-not (Test-Path -LiteralPath $cand)) { continue }
  $ok = & $cand -p "const [a,b]=process.versions.node.split('.').map(Number); a>22||(a===22&&b>=13)" 2>$null
  if ($LASTEXITCODE -eq 0 -and "$ok".Trim() -eq 'true') {
    $runtime = $cand
    break
  }
}

if (-not $runtime) {
  throw '未找到可用的 Node.js（需要 >= 22.13），请安装 Node.js 或先启动一次 Antigravity。'
}

$script = if ($Mode -eq 'Uninstall') { 'scripts/uninstall.mjs' } else { 'scripts/install.mjs' }
& $runtime (Join-Path $PSScriptRoot $script) @Arguments
exit $LASTEXITCODE
