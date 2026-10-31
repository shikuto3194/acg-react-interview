param(
  [Parameter(Mandatory = $true)]
  [string]$Path,

  [switch]$Apply,

  [string]$BackupDir = ".mojibake-backups"
)

$ErrorActionPreference = "Stop"

$fullPath = (Resolve-Path $Path).Path
$utf8 = [System.Text.UTF8Encoding]::new($false)
$cp932 = [System.Text.Encoding]::GetEncoding(932)
$markerChars = @(
  0x7E5D, 0x7E67, 0x7E3A, 0x8B4C, 0x8373, 0x86FB, 0x873F,
  0x9015, 0x96A7, 0x8B28, 0x8C41, 0x9AE2, 0x879F, 0x87C4,
  0x9A65, 0x8B41, 0x8B5B, 0x8757, 0x880E, 0x87B3, 0x87C6
) | ForEach-Object { [char]$_ }
$markerPattern = "[{0}]" -f (-join $markerChars)
$segmentPattern = '[^\u0000-\u007F]{2,}'

function Repair-Text([string]$text) {
  if ([string]::IsNullOrEmpty($text)) {
    return $null
  }

  $bytes = $cp932.GetBytes($text)
  $repaired = [System.Text.Encoding]::UTF8.GetString($bytes)
  if ($repaired -eq $text) {
    return $null
  }

  if ($repaired.Contains([char]0xFFFD)) {
    return $null
  }

  $beforeMarkers = ([regex]::Matches($text, $markerPattern)).Count
  $afterMarkers = ([regex]::Matches($repaired, $markerPattern)).Count
  $hasKana = $repaired -match '[\p{IsHiragana}\p{IsKatakana}]'
  $looksReadable = $repaired -match '[\p{IsCJKUnifiedIdeographs}\p{IsHiragana}\p{IsKatakana}]' -or $repaired -match '[\u3001\u3002\u300C\u300D\u300E\u300F\u30FB]'

  if (($afterMarkers -lt $beforeMarkers) -and ($hasKana -or $looksReadable)) {
    return $repaired
  }

  return $null
}

$lines = [System.IO.File]::ReadAllLines($fullPath, $utf8)
$preview = New-Object System.Collections.Generic.List[object]

for ($i = 0; $i -lt $lines.Length; $i++) {
  $originalLine = $lines[$i]
  if ($originalLine -notmatch $markerPattern) {
    continue
  }

  $updatedLine = [regex]::Replace($originalLine, $segmentPattern, {
      param($match)
      $segment = $match.Value
      if ($segment -notmatch $markerPattern) {
        return $segment
      }

      $repaired = Repair-Text $segment
      if ($null -eq $repaired) {
        return $segment
      }

      return $repaired
    })

  if ($updatedLine -ne $originalLine) {
    $preview.Add([pscustomobject]@{
        Line     = $i + 1
        Original = $originalLine
        Repaired = $updatedLine
      }) | Out-Null
    $lines[$i] = $updatedLine
  }
}

if ($preview.Count -eq 0) {
  Write-Output "No repair candidates found in $fullPath"
  exit 0
}

Write-Output "Repair candidates in $fullPath"
foreach ($item in $preview) {
  Write-Output ("Line {0}" -f $item.Line)
  Write-Output ("  Before: {0}" -f $item.Original)
  Write-Output ("  After : {0}" -f $item.Repaired)
}

if (-not $Apply) {
  Write-Output ""
  Write-Output "Preview only. Re-run with -Apply to write the repaired text."
  exit 0
}

$backupRoot = Join-Path (Get-Location) $BackupDir
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$backupName = "{0}.{1:yyyyMMdd-HHmmss}.bak" -f [System.IO.Path]::GetFileName($fullPath), (Get-Date)
$backupPath = Join-Path $backupRoot $backupName
[System.IO.File]::Copy($fullPath, $backupPath, $true)
[System.IO.File]::WriteAllLines($fullPath, $lines, $utf8)

Write-Output ""
Write-Output "Backup: $backupPath"
Write-Output "Applied repairs to $fullPath"
