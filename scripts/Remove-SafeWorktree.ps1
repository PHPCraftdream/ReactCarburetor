[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'This script handles Windows junctions only.'
}

if ($Name -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]*$') {
    throw 'Name must be one direct child name under worktrees.'
}

function Test-SamePath([string]$Left, [string]$Right) {
    $a = [IO.Path]::GetFullPath($Left).TrimEnd('\')
    $b = [IO.Path]::GetFullPath($Right).TrimEnd('\')
    return [string]::Equals($a, $b, [StringComparison]::OrdinalIgnoreCase)
}

$checkoutRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$commonGit = @(& git -C $checkoutRoot rev-parse --path-format=absolute --git-common-dir)
if ($LASTEXITCODE -ne 0 -or $commonGit.Count -ne 1) {
    throw 'Could not locate the common Git directory.'
}
$commonGitPath = [IO.Path]::GetFullPath($commonGit[0]).TrimEnd('\')
if ([IO.Path]::GetFileName($commonGitPath) -ne '.git' -or
    -not (Test-Path -LiteralPath $commonGitPath -PathType Container)) {
    throw 'Expected a regular repository with a common .git directory.'
}
$repoRoot = [IO.Path]::GetDirectoryName($commonGitPath)
$worktreesRoot = Join-Path $repoRoot 'worktrees'
$worktree = [IO.Path]::GetFullPath((Join-Path $worktreesRoot $Name)).TrimEnd('\')
$sharedReact = Join-Path $repoRoot 'node_modules\react'

if (-not (Test-SamePath ([IO.Path]::GetDirectoryName($worktree)) $worktreesRoot)) {
    throw 'Worktree must be a direct child of worktrees.'
}

if (-not (Test-Path -LiteralPath $worktree -PathType Container)) {
    throw "Worktree does not exist: $worktree"
}

if (-not (Test-Path -LiteralPath $sharedReact -PathType Container)) {
    throw "Shared React target is missing: $sharedReact"
}

$rootItem = Get-Item -LiteralPath $worktree -Force
if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'The worktree itself is a reparse point.'
}

$listing = @(& git -C $repoRoot worktree list --porcelain)
if ($LASTEXITCODE -ne 0) {
    throw 'Could not read git worktrees.'
}

$registered = $false
foreach ($line in $listing) {
    if ($line.StartsWith('worktree ') -and (Test-SamePath $line.Substring(9) $worktree)) {
        $registered = $true
        break
    }
}
if (-not $registered) {
    throw 'The directory is not a registered worktree of this repository.'
}

$junction = Join-Path $worktree 'node_modules\react'
$hasJunction = Test-Path -LiteralPath $junction
if ($hasJunction) {
    $item = Get-Item -LiteralPath $junction -Force
    $target = @($item.Target)[0]
    if ($item.LinkType -ne 'Junction' -or -not (Test-SamePath $target $sharedReact)) {
        throw "Unexpected link or target: $junction"
    }
}

function Assert-ReparsePoints([string]$Root, [string]$AllowedJunction) {
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($Root)

    while ($pending.Count -gt 0) {
        foreach ($entry in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
            if (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                if (-not $AllowedJunction -or -not (Test-SamePath $entry.FullName $AllowedJunction)) {
                    throw "Unexpected reparse point: $($entry.FullName)"
                }
                continue
            }
            if ($entry.PSIsContainer) {
                $pending.Push($entry.FullName)
            }
        }
    }
}

Assert-ReparsePoints $worktree $(if ($hasJunction) { $junction } else { '' })

if (-not $Apply) {
    Write-Output "Dry run OK: $worktree"
    Write-Output $(if ($hasJunction) { "Would unlink: $junction" } else { 'No junction to unlink.' })
    Write-Output 'Would remove the registered worktree. Pass -Apply to do it.'
    return
}

if ($hasJunction) {
    Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
namespace ReactCarburetor {
    public static class JunctionRemoval {
        [DllImport("kernel32.dll", EntryPoint = "RemoveDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool RemoveDirectory(string path);
    }
}
'@

    if (-not [ReactCarburetor.JunctionRemoval]::RemoveDirectory($junction)) {
        $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "Could not unlink junction (Win32 $errorCode): $junction"
    }
    if ((Test-Path -LiteralPath $junction) -or -not (Test-Path -LiteralPath $sharedReact)) {
        throw 'Junction removal did not leave the expected target intact.'
    }
}

Assert-ReparsePoints $worktree ''
& git -C $repoRoot worktree remove --force $worktree
if ($LASTEXITCODE -ne 0 -or (Test-Path -LiteralPath $worktree)) {
    throw "Git could not remove the worktree: $worktree"
}

Write-Output "Removed worktree: $worktree"
