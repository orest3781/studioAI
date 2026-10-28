param([Parameter(Mandatory)][string]$Dist, [Parameter(Mandatory)][string]$Version, [Parameter(Mandatory)][string]$Publisher)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a stable release version.' }
$expected = @((Join-Path $Dist "StudioAI-$Version-Windows-x64.exe"), (Join-Path $Dist 'win-unpacked/StudioAI.exe'))
$evidence = @()
foreach ($file in $expected) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing artifact: $file" }
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid') { throw "Untrusted or unsigned artifact: $file ($($signature.Status))" }
    $subject = $signature.SignerCertificate.Subject
    $simple = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($Publisher -cne $subject -and $Publisher -cne $simple) { throw "Unexpected publisher on $file" }
    if (-not $signature.TimeStamperCertificate) { throw "Missing trusted timestamp: $file" }
    $evidence += @{file=(Split-Path $file -Leaf); sha256=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash; publisher=$subject; signer=$signature.SignerCertificate.Thumbprint; status='Valid'}
}
foreach ($file in @('latest.yml', "StudioAI-$Version-Windows-x64.exe.blockmap", 'win-unpacked/resources/app-update.yml')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Dist $file))) { throw "Missing update metadata: $file" }
}
$metadata = Get-Content -LiteralPath (Join-Path $Dist 'win-unpacked/resources/app-update.yml') -Raw
if ($metadata -notmatch '(?m)^publisherName:' -or $metadata -match '(?m)^verifyUpdateCodeSignature:\s*false') { throw 'Update publisher verification is not configured.' }
$evidence | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $Dist 'signature-verification.json') -Encoding utf8
Write-Output 'Installer and app have valid Windows signatures, expected publisher, and timestamps.'
