param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [Parameter(Mandatory = $true)][int]$KeepProcessId
)

$normalizedRoot = [System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
$processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop

foreach ($process in $processes) {
  if ($process.ProcessId -eq $KeepProcessId -or !$process.CommandLine) { continue }
  $belongsToProject = $process.CommandLine.IndexOf($normalizedRoot, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  $isSigedDevProcess = $process.CommandLine -match '(?i)(server[\\/](index|supervisor|dev)\.js|vite[\\/]bin[\\/]vite\.js|concurrently)'
  if (!$belongsToProject -or !$isSigedDevProcess) { continue }

  & taskkill.exe /PID $process.ProcessId /T /F *> $null
  if ($LASTEXITCODE -eq 0) { Write-Output "Closed stale SIGED process $($process.ProcessId)" }
}
