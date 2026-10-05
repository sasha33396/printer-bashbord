param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][string]$ExpectedDomain
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = New-Object System.Text.UTF8Encoding($false)

try {
    $phase = 'ad_module'
    Import-Module ActiveDirectory -ErrorAction Stop
    $phase = 'ad_connection'
    $domain = Get-ADDomain -Server $Server -ErrorAction Stop
    $phase = 'ad_domain_mismatch'
    if ($domain.DNSRoot.TrimEnd('.').ToLowerInvariant() -ne $ExpectedDomain.TrimEnd('.').ToLowerInvariant()) {
        throw 'Configured AD domain does not match the connected domain'
    }
    $allowedDomains = @($domain.DNSRoot.ToLowerInvariant(), $domain.NetBIOSName.ToLowerInvariant())
    $phase = 'ad_input'
    # PowerShell 5.1 returns the JSON array as one pipeline object; avoid nesting it.
    $queries = Get-Content -LiteralPath $InputPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $users = @()
    foreach ($query in $queries) {
        $result = [ordered]@{ key = [string]$query.key; status = 'not_found' }
        $login = ([string]$query.raw_login).Trim()
        $hint = ([string]$query.domain_hint).Trim().TrimEnd('.').ToLowerInvariant()
        if (-not $login -or $login -match '\s' -or $login.Length -gt 255) {
            $result.status = 'invalid_login'
            $users += [pscustomobject]$result
            continue
        }
        if ($hint -and $hint -notin $allowedDomains) {
            $result.status = 'foreign_domain'
            $users += [pscustomobject]$result
            continue
        }
        $upn = $null
        if ($login.Contains('\')) {
            $parts = $login.Split('\')
            if ($parts.Count -ne 2 -or $parts[0].TrimEnd('.').ToLowerInvariant() -notin $allowedDomains) {
                $result.status = 'foreign_domain'
                $users += [pscustomobject]$result
                continue
            }
            $login = $parts[1]
            if (-not $login -or $login.Contains('@')) {
                $result.status = 'invalid_login'
                $users += [pscustomobject]$result
                continue
            }
        } elseif ($login.Contains('@')) {
            if (($login.Split('@')).Count -ne 2) {
                $result.status = 'invalid_login'
                $users += [pscustomobject]$result
                continue
            }
            $upn = $login
        }
        try {
            $properties = @('DisplayName', 'GivenName', 'Surname', 'Title', 'EmailAddress', 'telephoneNumber')
            if ($upn) {
                $matches = @(Get-ADUser -Filter { UserPrincipalName -eq $upn } -Properties $properties -Server $Server -ErrorAction Stop)
            } else {
                $matches = @(Get-ADUser -Identity $login -Properties $properties -Server $Server -ErrorAction Stop)
            }
            if ($matches.Count -eq 1) {
                $user = $matches[0]
                if ((-not $upn -and $user.SamAccountName -ine $login) -or ($upn -and $user.UserPrincipalName -ine $upn)) {
                    $result.status = 'invalid_login'
                } elseif (-not $user.Enabled) {
                    $result.status = 'disabled'
                } else {
                    $fullName = $user.DisplayName
                    if ([string]::IsNullOrWhiteSpace($fullName)) { $fullName = ($user.Surname + ' ' + $user.GivenName).Trim() }
                    if ([string]::IsNullOrWhiteSpace($fullName)) { $fullName = $user.Name }
                    $result.status = 'found'
                    $result.employee = [ordered]@{
                        ad_login = $user.SamAccountName
                        domain = $domain.DNSRoot
                        ad_guid = $user.ObjectGUID.ToString()
                        full_name = $fullName
                        ad_enabled = [bool]$user.Enabled
                        position = $user.Title
                        email = $user.EmailAddress
                        phone = $user.telephoneNumber
                    }
                }
            } elseif ($matches.Count -gt 1) {
                $result.status = 'ambiguous'
            }
        } catch {
            if ($_.Exception.GetType().Name -eq 'ADIdentityNotFoundException') {
                $result.status = 'not_found'
            } else {
                $result.status = 'query_error'
            }
        }
        $users += [pscustomobject]$result
    }
    $response = [ordered]@{ ok = $true; users = @($users) }
    [System.IO.File]::WriteAllText($OutputPath, ($response | ConvertTo-Json -Depth 8), $utf8)
    exit 0
} catch {
    $failure = [ordered]@{ ok = $false; error = $phase }
    [System.IO.File]::WriteAllText($OutputPath, ($failure | ConvertTo-Json), $utf8)
    exit 1
}
