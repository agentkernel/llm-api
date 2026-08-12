#requires -version 5
# 把 workbuddy-patch 应用到干净的 Sub2API v0.1.175 检出。
param(
  [Parameter(Mandatory = $true)][string]$Dest,
  [string]$Tag = "v0.1.175",
  [string]$RepoUrl = "https://github.com/Wei-Shaw/sub2api.git"
)
$ErrorActionPreference = "Stop"
$patch = Join-Path $PSScriptRoot "workbuddy-patch.diff"
if (-not (Test-Path $patch)) { throw "patch not found: $patch" }

if (-not (Test-Path (Join-Path $Dest ".git"))) {
  Write-Host "cloning $Tag into $Dest ..."
  git clone --depth 1 --branch $Tag $RepoUrl $Dest
}
Push-Location $Dest
try {
  git switch -c workbuddy-patch 2>$null
  git apply --check $patch
  git apply $patch
  Write-Host "patch applied. build with: cd backend; go build ./..."
} finally {
  Pop-Location
}
