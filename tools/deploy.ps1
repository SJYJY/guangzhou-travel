# 一键发布到 GitHub Pages：登录 -> 建仓库（首次）-> 上传 -> 开启 Pages
# 以后改了网站内容，再双击「发布到网站.bat」即可更新
$repo = "guangzhou-travel"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Host "没有找到 git，请先安装 Git for Windows" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "【第 1 步】登录 GitHub —— 如果弹出登录窗口，请选「Sign in with your browser」并在浏览器点 Authorize" -ForegroundColor Cyan
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# 通过临时文件把凭据请求交给 git（避免 PowerShell 管道插入 BOM 导致 “missing protocol field”）
function GitCred($action, $text) {
  $f = [IO.Path]::GetTempFileName()
  [IO.File]::WriteAllText($f, $text, (New-Object System.Text.ASCIIEncoding))
  $r = cmd /c "git -c credential.interactive=always credential $action < `"$f`""
  Remove-Item $f -ErrorAction SilentlyContinue
  return $r
}
$cred = GitCred "fill" "protocol=https`nhost=github.com`n`n"
$user = (($cred | Where-Object { $_ -like "username=*" }) -replace "^username=", "")
$tok = (($cred | Where-Object { $_ -like "password=*" }) -replace "^password=", "")
if (-not $tok) { Write-Host "登录失败或已取消" -ForegroundColor Red; exit 1 }
$H = @{ Authorization = "Bearer $tok"; Accept = "application/vnd.github+json"; "User-Agent" = "gz-travel-deploy" }
try { $me = Invoke-RestMethod "https://api.github.com/user" -Headers $H } catch { Write-Host "登录凭据无效：$_" -ForegroundColor Red; GitCred "reject" "protocol=https`nhost=github.com`nusername=$user`n`n" | Out-Null; exit 1 }
$login = $me.login
GitCred "approve" "protocol=https`nhost=github.com`nusername=$user`npassword=$tok`n`n" | Out-Null
Write-Host "已登录：$login" -ForegroundColor Green

Write-Host "【第 2 步】检查 / 创建仓库 $login/$repo" -ForegroundColor Cyan
$exists = $true
try { Invoke-RestMethod "https://api.github.com/repos/$login/$repo" -Headers $H | Out-Null } catch { $exists = $false }
if (-not $exists) {
  $body = @{ name = $repo; description = "Guangzhou travel guide: map, routes, weather, food, photos"; homepage = "https://$login.github.io/$repo/"; has_wiki = $false } | ConvertTo-Json
  Invoke-RestMethod "https://api.github.com/user/repos" -Method Post -Headers $H -Body $body -ContentType "application/json" | Out-Null
  Write-Host "已创建公开仓库 https://github.com/$login/$repo" -ForegroundColor Green
} else { Write-Host "仓库已存在，将更新内容" }

Write-Host "【第 3 步】上传网站文件" -ForegroundColor Cyan
if (-not (Test-Path ".git")) { git init -q -b main }
git config user.name $login
git config user.email "$($me.id)+$login@users.noreply.github.com"
git config core.quotepath false
git add -A
git commit -q -m ("Update site " + (Get-Date -Format "yyyy-MM-dd HH:mm")) 2>$null
git remote remove origin 2>$null
git remote add origin "https://github.com/$login/$repo.git"
git push -u origin main
if ($LASTEXITCODE -ne 0) { Write-Host "上传失败，请检查网络后重试（国内网络推送 GitHub 偶尔会超时）" -ForegroundColor Red; exit 1 }

Write-Host "【第 4 步】开启 GitHub Pages" -ForegroundColor Cyan
try {
  Invoke-RestMethod "https://api.github.com/repos/$login/$repo/pages" -Method Post -Headers $H -Body '{"source":{"branch":"main","path":"/"}}' -ContentType "application/json" | Out-Null
  Write-Host "Pages 已开启" -ForegroundColor Green
} catch { Write-Host "Pages 之前已开启（或稍后自动生效）" }

$url = "https://$login.github.io/$repo/"
Set-Content -Path (Join-Path $root "tools\site_url.txt") -Value $url -Encoding UTF8
Write-Host ""
Write-Host "完成！网站地址：$url" -ForegroundColor Green
Write-Host "首次发布约需 1-2 分钟生效，如果打开是 404 请稍等再刷新。"
Start-Sleep 3
Start-Process $url
