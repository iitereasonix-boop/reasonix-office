$ErrorActionPreference = "Stop"
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

if (Test-Path ".env") {
  throw "A .env file already exists. Keep it unchanged and follow the manual setup steps in README.md."
}

$psql = (Get-Command "psql.exe" -ErrorAction SilentlyContinue).Source
if (-not $psql) {
  $postgresRoot = Join-Path $env:ProgramFiles "PostgreSQL"
  $psql = Get-ChildItem $postgresRoot -Filter "psql.exe" -Recurse -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}
if (-not $psql) {
  throw "psql.exe was not found. Install the PostgreSQL command-line tools and retry."
}

$adminUser = Read-Host "PostgreSQL admin role [postgres]"
if ([string]::IsNullOrWhiteSpace($adminUser)) { $adminUser = "postgres" }
$portInput = Read-Host "Local PostgreSQL port [5432]"
$port = 5432
if (-not [string]::IsNullOrWhiteSpace($portInput) -and
    (-not [int]::TryParse($portInput, [ref]$port) -or $port -lt 1 -or $port -gt 65535)) {
  throw "The PostgreSQL port must be between 1 and 65535."
}
$adminSecure = Read-Host "PostgreSQL admin password (entered locally; not saved)" -AsSecureString
$adminPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminSecure)
$adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPointer)

$email = (Read-Host "Initial senior lawyer email").Trim().ToLowerInvariant()
if ($email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPointer)
  throw "Enter a valid email address."
}
$initialSecure = Read-Host "Initial senior lawyer password (12+ letters, numbers, _ or -)" -AsSecureString
$initialPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($initialSecure)
$initialPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($initialPointer)
if ($initialPassword.Length -lt 12 -or $initialPassword -notmatch '^[A-Za-z0-9_-]+$') {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPointer)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($initialPointer)
  throw "Use at least 12 characters containing only letters, numbers, _ or -."
}

$env:PGPASSWORD = $adminPassword
$adminArgs = @("-X", "-w", "-h", "127.0.0.1", "-p", "$port", "-U", $adminUser, "-d", "postgres", "-tA", "-v", "ON_ERROR_STOP=1")
$sqlFile = Join-Path $env:TEMP ("reasonix-db-" + [Guid]::NewGuid().ToString("N") + ".sql")
$roleCreated = $false

function Invoke-AdminQuery([string]$sql) {
  $result = & $psql @adminArgs -c $sql 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "PostgreSQL rejected a setup command. Check the local admin login and server logs."
  }
  return ($result | Out-String).Trim()
}

try {
  if ((Invoke-AdminQuery "SELECT 1 FROM pg_roles WHERE rolname = 'reasonix_app'") -eq "1") {
    throw "The PostgreSQL role reasonix_app already exists; no database changes were made."
  }
  if ((Invoke-AdminQuery "SELECT 1 FROM pg_database WHERE datname = 'reasonix'") -eq "1") {
    throw "The PostgreSQL database reasonix already exists; no database changes were made."
  }

  $randomBytes = New-Object byte[] 32
  $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
  $randomGenerator.GetBytes($randomBytes)
  $randomGenerator.Dispose()
  $appPassword = [BitConverter]::ToString($randomBytes).Replace("-", "").ToLowerInvariant()
  $createRoleSql = "CREATE ROLE reasonix_app LOGIN PASSWORD '$appPassword';"
  $utf8 = New-Object System.Text.UTF8Encoding -ArgumentList $false
  [IO.File]::WriteAllText($sqlFile, $createRoleSql, $utf8)
  $result = & $psql @adminArgs -f $sqlFile 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create the reasonix_app database role."
  }
  $roleCreated = $true

  [void](Invoke-AdminQuery "CREATE DATABASE reasonix OWNER reasonix_app")
  $databaseUrl = "postgresql://reasonix_app:$appPassword@127.0.0.1:$port/reasonix?schema=public"
  $envContent = "DATABASE_URL=`"$databaseUrl`"`r`nINITIAL_LAWYER_EMAIL=`"$email`"`r`nINITIAL_LAWYER_PASSWORD=`"$initialPassword`"`r`n"
  [IO.File]::WriteAllText((Join-Path $projectRoot ".env"), $envContent, $utf8)

  $env:DATABASE_URL = $databaseUrl
  $env:INITIAL_LAWYER_EMAIL = $email
  $env:INITIAL_LAWYER_PASSWORD = $initialPassword
  $env:PGPASSWORD = $appPassword

  & npm.cmd run db:generate
  if ($LASTEXITCODE -ne 0) { throw "Prisma client generation failed. The database and local .env are ready; see README.md to resume." }
  # Applies the tables and the row-security policies, which now live in prisma/migrations.
  & npm.cmd run db:deploy
  if ($LASTEXITCODE -ne 0) { throw "Database migration failed. The database and local .env are ready; see README.md to resume." }

  & npm.cmd run db:seed
  if ($LASTEXITCODE -ne 0) { throw "Initial lawyer setup failed. The database and local .env are ready; see README.md to resume." }

  Write-Output "Database, access policies, and initial senior-lawyer account are ready."
  Write-Output "Local connection details were saved to the ignored .env file."
}
catch {
  if ($roleCreated -and -not (Test-Path (Join-Path $projectRoot ".env"))) {
    try { [void](Invoke-AdminQuery "DROP ROLE IF EXISTS reasonix_app") } catch { }
  }
  throw
}
finally {
  if (Test-Path $sqlFile) { Remove-Item -LiteralPath $sqlFile -Force }
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:\INITIAL_LAWYER_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:\INITIAL_LAWYER_PASSWORD -ErrorAction SilentlyContinue
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPointer)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($initialPointer)
}
