$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$DebugPreference = 'SilentlyContinue'
try {
    . (Join-Path $PSScriptRoot 'host-core.ps1')
    $options = Get-GeminiProvisionOptions -Arguments $args
    $dependencies = @{
        CheckIdentity = {
            $null = & python -c "from serial.tools.list_ports import comports; import sys; sys.exit(0 if sum(p.device == sys.argv[1] and p.vid == 0x303A and p.pid == 0x1001 and p.serial_number == sys.argv[2] for p in comports()) == 1 else 1)" $options.Port $options.DeviceSerial 2>$null
            return $LASTEXITCODE -eq 0
        }.GetNewClosure()
        LoadSecret = {
            $saved = Import-Clixml -LiteralPath $options.KeyPath
            if ($saved -is [Security.SecureString]) { return $saved }
            if ($saved -is [Management.Automation.PSCredential]) { return $saved.Password }
            throw 'Unsupported credential container'
        }.GetNewClosure()
        OpenPort = {
            $connection = [IO.Ports.SerialPort]::new($options.Port, 115200)
            try {
                $connection.ReadTimeout = 200
                $connection.WriteTimeout = 1000
                $connection.Open()
                return $connection
            }
            catch { $connection.Dispose(); throw 'Device unavailable' }
        }.GetNewClosure()
        Sleep = { param($Milliseconds) Start-Sleep -Milliseconds $Milliseconds }
        Now = { return [Diagnostics.Stopwatch]::GetTimestamp() / [double][Diagnostics.Stopwatch]::Frequency }
    }
    $result = Invoke-GeminiKeyProvision -Dependencies $dependencies -Canary:([bool]$options.Canary)
    if ($result -eq 0) {
        if ($options.Canary) { Write-Output 'CANARY PASS' } else { Write-Output 'SAVED' }
    }
    else { Write-Output 'RESULT NOT CONFIRMED; storage may have changed' }
    exit $result
}
catch {
    Write-Output 'RESULT NOT CONFIRMED; storage may have changed'
    exit 1
}
