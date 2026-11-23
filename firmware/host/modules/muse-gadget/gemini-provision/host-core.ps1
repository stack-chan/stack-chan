function Get-GeminiProvisionOptions {
    param([object[]]$Arguments)
    $options = @{ Canary = $false; KeyPath = $null; Port = $null; DeviceSerial = $null }
    $seen = @{}
    for ($i = 0; $i -lt $Arguments.Count; $i++) {
        $name = [string]$Arguments[$i]
        if ($name -notin @('-KeyPath', '-Port', '-DeviceSerial', '-Canary') -or $seen.ContainsKey($name)) {
            throw 'Unsupported arguments'
        }
        $seen[$name] = $true
        if ($name -eq '-Canary') { $options.Canary = $true; continue }
        $i++
        if ($i -ge $Arguments.Count -or $Arguments[$i] -isnot [string]) { throw 'Unsupported arguments' }
        $value = $Arguments[$i]
        if ([string]::IsNullOrWhiteSpace($value) -or $value.StartsWith('-')) { throw 'Unsupported arguments' }
        switch ($name) {
            '-KeyPath' {
                if ($value -notmatch '^[A-Za-z]:[\\/]' -or $value -match '[\x00-\x1f]' -or
                    $value.Substring(2).Contains(':') -or [IO.Path]::GetExtension($value) -ine '.clixml') {
                    throw 'Unsupported key path'
                }
                $options.KeyPath = $value
            }
            '-Port' {
                if ($value -notmatch '^COM[1-9][0-9]{0,2}$') { throw 'Unsupported port' }
                $options.Port = $value.ToUpperInvariant()
            }
            '-DeviceSerial' {
                if ($value -notmatch '^[A-Za-z0-9:_-]{1,128}$') { throw 'Unsupported device serial' }
                $options.DeviceSerial = $value
            }
        }
    }
    if (-not $options.Port -or -not $options.DeviceSerial -or (-not $options.Canary -and -not $options.KeyPath)) {
        throw 'Required arguments missing'
    }
    return $options
}

function ConvertTo-GeminiPayload {
    param([Security.SecureString]$Secret)
    $pointer = [IntPtr]::Zero
    $payload = $null
    $complete = $false
    try {
        $length = $Secret.Length
        if ($length -lt 20 -or $length -gt 512) { throw 'Invalid credential format' }
        $payload = [byte[]]::new($length + 8)
        [Text.Encoding]::ASCII.GetBytes('GEMINI:').CopyTo($payload, 0)
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secret)
        for ($i = 0; $i -lt $length; $i++) {
            $character = [Runtime.InteropServices.Marshal]::ReadInt16($pointer, $i * 2)
            if ($character -lt 33 -or $character -gt 126) { throw 'Invalid credential format' }
            $payload[$i + 7] = [byte]$character
        }
        $payload[$payload.Length - 1] = 10
        $complete = $true
        return ,$payload
    }
    finally {
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        if (-not $complete -and $null -ne $payload) { [Array]::Clear($payload, 0, $payload.Length) }
    }
}

function Test-GeminiFixedLine {
    param([byte[]]$Buffer, [int]$Length, [string]$Expected)
    if ($Length -gt 0 -and $Buffer[$Length - 1] -eq 13) { $Length-- }
    if ($Length -ne $Expected.Length) { return $false }
    for ($i = 0; $i -lt $Length; $i++) {
        if ($Buffer[$i] -ne [int][char]$Expected[$i]) { return $false }
    }
    return $true
}

function Wait-GeminiResponse {
    param($Port, [string]$Expected, [int]$TimeoutSeconds, [scriptblock]$Now)
    $buffer = [byte[]]::new(256)
    $line = [byte[]]::new(256)
    $length = 0
    $deadline = (& $Now) + $TimeoutSeconds
    try {
        while ((& $Now) -lt $deadline) {
            try { $count = $Port.Read($buffer, 0, $buffer.Length) }
            catch [TimeoutException] { continue }
            for ($i = 0; $i -lt $count; $i++) {
                if ($buffer[$i] -eq 10) {
                    if ((Test-GeminiFixedLine $line $length 'GEMINI KEY EXISTS') -or
                        (Test-GeminiFixedLine $line $length 'GEMINI KEY REJECTED')) { return $false }
                    if (Test-GeminiFixedLine $line $length $Expected) { return $true }
                    [Array]::Clear($line, 0, $line.Length)
                    $length = 0
                }
                elseif ($length -ge $line.Length) { return $false }
                else { $line[$length++] = $buffer[$i] }
            }
            [Array]::Clear($buffer, 0, $buffer.Length)
        }
        return $false
    }
    finally {
        [Array]::Clear($buffer, 0, $buffer.Length)
        [Array]::Clear($line, 0, $line.Length)
    }
}

function Invoke-GeminiKeyProvision {
    param([hashtable]$Dependencies, [switch]$Canary)
    $payload = $null
    $secret = $null
    $port = $null
    try {
        if (-not (& $Dependencies.CheckIdentity)) { return 1 }
        if ($Canary) { $payload = [Text.Encoding]::ASCII.GetBytes("CANARY`n") }
        else {
            $secret = & $Dependencies.LoadSecret
            if ($secret -isnot [Security.SecureString]) { return 1 }
            $payload = ConvertTo-GeminiPayload $secret
        }
        if (-not (& $Dependencies.CheckIdentity)) { return 1 }
        $port = & $Dependencies.OpenPort
        if ($null -eq $port) { return 1 }
        $port.DiscardInBuffer()
        $port.DtrEnable = $false
        $port.RtsEnable = $true
        & $Dependencies.Sleep 100
        $port.RtsEnable = $false
        if (-not (Wait-GeminiResponse $port 'GEMINI KEY INPUT READY' 20 $Dependencies.Now)) { return 1 }
        for ($offset = 0; $offset -lt $payload.Length; $offset += 24) {
            $count = [Math]::Min(24, $payload.Length - $offset)
            $port.Write($payload, $offset, $count)
            & $Dependencies.Sleep 40
        }
        $expected = if ($Canary) { 'GEMINI KEY CANARY PASS' } else { 'GEMINI KEY SAVED' }
        if (Wait-GeminiResponse $port $expected 6 $Dependencies.Now) { return 0 }
        return 1
    }
    catch { return 1 }
    finally {
        if ($null -ne $payload) { [Array]::Clear($payload, 0, $payload.Length) }
        if ($null -ne $secret -and $secret -is [Security.SecureString]) { $secret.Dispose() }
        if ($null -ne $port) {
            try { $port.Close() } catch { }
            try { $port.Dispose() } catch { }
        }
    }
}
