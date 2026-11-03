<#
  2 of 3: COPY the data from one PostgreSQL database to another (Supabase -> Azure), using pg_dump and psql.

  It only READS from the source. Into the target it loads everything in ONE transaction, so a failure
  changes nothing. Run 1-create-schema.sql on the target first, and make sure the target tables are empty.

  Needs the PostgreSQL client tools (pg_dump, psql). They come with a normal PostgreSQL install.

  Connection strings are read from environment variables, so no password goes in a file or in your history
  if you type them at the prompt:

    $env:SOURCE_DB_URL = Read-Host "Source (Supabase) connection string"
    $env:TARGET_DB_URL = Read-Host "Target (Azure) connection string"
    .\scripts\postgres\2-copy-data.ps1
    Remove-Item Env:SOURCE_DB_URL, Env:TARGET_DB_URL

  Connection string format:  postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require
  Supabase: Project Settings > Database > Connection string (use the direct or session pooler string, not the
  transaction pooler). Azure: the host, database and user from the server's Connect page.

  Optional: -DumpFile keeps the dump on disk (it holds real data: names, emails, photos). By default it is
  written to a temporary file and deleted afterwards.
#>
param([string]$DumpFile = '')

$ErrorActionPreference = 'Stop'

if (-not $env:SOURCE_DB_URL -or -not $env:TARGET_DB_URL) { throw 'Set SOURCE_DB_URL and TARGET_DB_URL first (see the top of this file).' }

function Find-Tool($name) {
    $found = Get-Command $name -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    $candidate = Get-ChildItem "$env:ProgramFiles\PostgreSQL\*\bin\$name.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
    if ($candidate) { return $candidate.FullName }
    throw "$name not found. Install the PostgreSQL client tools or add their bin folder to PATH."
}
$pgDump = Find-Tool 'pg_dump'
$psql = Find-Tool 'psql'

$tables = 'locations', 'teams', 'bookings', 'public_holidays', 'desks', 'desk_bookings', 'floor_elements', 'settings'
$tableArgs = $tables | ForEach-Object { '--table'; "public.$_" }
$dump = if ($DumpFile) { $DumpFile } else { Join-Path ([IO.Path]::GetTempPath()) "office-data-$([guid]::NewGuid()).sql" }

try {
    Write-Host 'Checking the target is empty...'
    $rows = & $psql $env:TARGET_DB_URL -At -v ON_ERROR_STOP=1 -c "select (select count(*) from locations) + (select count(*) from teams) + (select count(*) from bookings) + (select count(*) from desks) + (select count(*) from settings) + (select count(*) from public_holidays) + (select count(*) from desk_bookings) + (select count(*) from floor_elements)"
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the target (are the tables created? run 1-create-schema.sql first).' }
    if ([int]$rows -ne 0) { throw "The target already has $rows rows. This script only loads into an empty database." }

    Write-Host 'Dumping the data from the source (read only)...'
    & $pgDump $env:SOURCE_DB_URL --data-only --inserts --no-owner --no-privileges @tableArgs --file $dump
    if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed.' }

    Write-Host 'Loading into the target (one transaction)...'
    & $psql $env:TARGET_DB_URL -v ON_ERROR_STOP=1 --single-transaction --file $dump --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Loading failed. Nothing was changed on the target.' }

    # The holidays id is a serial column that was filled explicitly: move its sequence past the copied ids.
    & $psql $env:TARGET_DB_URL -At -v ON_ERROR_STOP=1 -c "select setval(pg_get_serial_sequence('public_holidays', 'id'), coalesce((select max(id) from public_holidays), 0) + 1, false)" | Out-Null

    Write-Host 'Done. Now run 3-verify.sql on BOTH databases and compare the counts.'
}
finally {
    if (-not $DumpFile -and (Test-Path $dump)) { Remove-Item $dump -Force }
    elseif ($DumpFile) { Write-Host "Dump kept at $DumpFile. It contains real data: delete it when you are done." }
}
