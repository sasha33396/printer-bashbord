# Run in PowerShell: .\start-demo.ps1 (or add -NoBrowser).
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$pythonCandidates = @(
    (Join-Path $projectRoot '.venv\Scripts\python.exe'),
    (Join-Path $projectRoot '.cache\runtime\python\python.exe')
)
$demoPython = $pythonCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $demoPython) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($pythonCommand -and $pythonCommand.Source -notlike '*\WindowsApps\*') {
        $demoPython = $pythonCommand.Source
    }
}
if (-not $demoPython) {
    throw 'Python 3.12 is required. See docs/demo.md for setup instructions.'
}
$demoArguments = @((Join-Path $projectRoot 'tools\run_demo.py'))
if ($NoBrowser) { $demoArguments += '--no-browser' }
& $demoPython @demoArguments
exit $LASTEXITCODE
