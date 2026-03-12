<#
.SYNOPSIS
Secure SSH connection script for System 2 Substrate Architecture remote deployment.

.DESCRIPTION
This script initiates an SSH connection to the remote deployment virtual machine.
#>

$RemoteUser = Read-Host "Enter SSH Username"
$RemoteHost = Read-Host "Enter SSH Host IP"

Write-Host "[*] Initializing connection to Deployment VM at $RemoteHost..."
Write-Host "Connecting..."

# Initiate SSH connection
ssh ${RemoteUser}@${RemoteHost}
