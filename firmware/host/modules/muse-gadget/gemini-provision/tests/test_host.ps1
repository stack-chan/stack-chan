$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../host-core.ps1')

Add-Type @'
using System;
using System.Collections.Generic;
using System.IO;
public class GeminiFakePort {
    public bool DtrEnable, RtsEnable, ThrowWrite;
    public int Closed, Disposed, Clears;
    public byte[] LastPayload;
    public Queue<byte[]> Responses = new Queue<byte[]>();
    public List<byte> Sent = new List<byte>();
    public void DiscardInBuffer() { Clears++; }
    public int Read(byte[] data, int offset, int count) {
        if (Responses.Count == 0) throw new TimeoutException();
        byte[] next = Responses.Dequeue();
        if (next.Length > count) throw new IOException();
        Array.Copy(next, 0, data, offset, next.Length);
        return next.Length;
    }
    public void Write(byte[] data, int offset, int count) {
        LastPayload = data;
        if (ThrowWrite) throw new IOException("PRIVATE FIXTURE MUST NOT BE DISPLAYED");
        for (int i = 0; i < count; i++) Sent.Add(data[offset + i]);
    }
    public void Close() { Closed++; }
    public void Dispose() { Disposed++; }
}
'@

function Assert-True {
    param([bool]$Value, [string]$Name)
    if (-not $Value) { throw "Test failed: $Name" }
}
function New-FixtureSecret {
    param([string]$Text = 'public-fixture-0123456789')
    $secret = [Security.SecureString]::new()
    foreach ($character in $Text.ToCharArray()) { $secret.AppendChar($character) }
    $secret.MakeReadOnly()
    return $secret
}
function New-Fixture {
    param([string]$Reply = 'GEMINI KEY SAVED')
    $state = @{ Checks = 0; Loads = 0; Opens = 0; Time = 0; WrongAt = 0; Key = 'public-fixture-0123456789' }
    $port = [GeminiFakePort]::new()
    $port.Responses.Enqueue([Text.Encoding]::ASCII.GetBytes("GEMINI KEY INPUT READY`n"))
    $port.Responses.Enqueue([Text.Encoding]::ASCII.GetBytes("$Reply`n"))
    $deps = @{
        CheckIdentity = { $state.Checks++; return $state.Checks -ne $state.WrongAt }.GetNewClosure()
        LoadSecret = { $state.Loads++; return New-FixtureSecret $state.Key }.GetNewClosure()
        OpenPort = { $state.Opens++; return $port }.GetNewClosure()
        Sleep = { param($Milliseconds) }
        Now = { $state.Time++; return $state.Time }.GetNewClosure()
    }
    return @{ State = $state; Port = $port; Dependencies = $deps }
}

$passed = 0
$options = Get-GeminiProvisionOptions @('-Port', 'com7', '-DeviceSerial', 'PUBLIC_SERIAL', '-KeyPath', 'C:\Private Keys\fixture.clixml')
Assert-True ($options.Port -ceq 'COM7' -and $options.DeviceSerial -ceq 'PUBLIC_SERIAL') 'explicit device selection'
Assert-True ($options.KeyPath -ceq 'C:\Private Keys\fixture.clixml' -and -not $options.Canary) 'explicit encrypted path'
$canaryOptions = Get-GeminiProvisionOptions @('-Port', 'COM7', '-DeviceSerial', 'PUBLIC_SERIAL', '-Canary')
Assert-True ($canaryOptions.Canary -and $null -eq $canaryOptions.KeyPath) 'canary needs no key path'
$passed++
$invalidArguments = @(
    @(),
    @('-Port', 'COM7', '-DeviceSerial', 'PUBLIC_SERIAL'),
    @('-Port', 'COM7', '-DeviceSerial', 'PUBLIC_SERIAL', '-KeyPath'),
    @('-Port', 'COM7', '-port', 'COM8', '-DeviceSerial', 'PUBLIC_SERIAL', '-Canary'),
    @('-Port', 'COM7', '-DeviceSerial', 'PUBLIC_SERIAL', '-Canary', '-Canary'),
    @('-Port', 'COM7', '-DeviceSerial', 'PUBLIC_SERIAL', '-KeyPath', 'PRIVATE_FIXTURE_MUST_NOT_APPEAR'),
    @('-Port', 'COM7', '-DeviceSerial', 'PUBLIC_SERIAL', '-KeyPath', '\\server\fixture.clixml'),
    @('-Port', 'COM7', '-DeviceSerial', 'PUBLIC_SERIAL', '-KeyPath', 'C:\fixture.clixml:stream'),
    @('-Port', 'COM7', '-DeviceSerial', 'PUBLIC_SERIAL', '-KeyPath', 'C:\plain-key.txt'),
    @('-Port', 'COM7', '-DeviceSerial', 'PUBLIC SERIAL', '-Canary'),
    @('-Port', 'COM7;anything', '-DeviceSerial', 'PUBLIC_SERIAL', '-Canary'),
    @('-Port', '-Canary', '-DeviceSerial', 'PUBLIC_SERIAL')
)
foreach ($arguments in $invalidArguments) {
    $rejected = $false
    try { $null = Get-GeminiProvisionOptions -Arguments $arguments } catch { $rejected = $true }
    Assert-True $rejected 'invalid selectors rejected'
}
$passed++
foreach ($length in @(20, 21, 512)) {
    $secret = New-FixtureSecret ('X' * $length)
    try {
        $payload = ConvertTo-GeminiPayload $secret
        Assert-True ($payload -is [byte[]] -and $payload.Length -eq $length + 8) 'valid length'
        Assert-True ($payload[0] -eq 71 -and $payload[-1] -eq 10) 'protocol bounds'
        [Array]::Clear($payload, 0, $payload.Length)
    }
    finally { $secret.Dispose() }
}
$passed++
foreach ($text in @('short', ('X' * 513), ('X' * 20 + ' '), ('X' * 20 + "`n"), ('X' * 20 + [char]0xE9))) {
    $secret = New-FixtureSecret $text
    $rejected = $false
    try { $null = ConvertTo-GeminiPayload $secret } catch { $rejected = $true } finally { $secret.Dispose() }
    Assert-True $rejected 'invalid key rejection'
}
$passed++
$f = New-Fixture
$output = @(Invoke-GeminiKeyProvision -Dependencies $f.Dependencies)
Assert-True ($output.Count -eq 1 -and $output[0] -eq 0) 'success only returns code'
Assert-True ($f.State.Checks -eq 2 -and $f.State.Loads -eq 1 -and $f.State.Opens -eq 1) 'identity twice'
Assert-True ($f.Port.Closed -eq 1 -and $f.Port.Disposed -eq 1) 'port released'
Assert-True (-not ($f.Port.LastPayload | Where-Object { $_ -ne 0 })) 'payload wiped'
Assert-True ([Text.Encoding]::ASCII.GetString($f.Port.Sent.ToArray()) -ceq "GEMINI:public-fixture-0123456789`n") 'transport fixture'
$passed++
foreach ($wrongAt in @(1, 2)) {
    $f = New-Fixture
    $f.State.WrongAt = $wrongAt
    Assert-True ((Invoke-GeminiKeyProvision -Dependencies $f.Dependencies) -eq 1) 'identity refusal'
    Assert-True ($f.State.Opens -eq 0) 'identity prevents opening'
    Assert-True ($f.State.Loads -eq ($wrongAt - 1)) 'identity checked before decrypt'
}
$passed++
$f = New-Fixture 'GEMINI KEY CANARY PASS'
Assert-True ((Invoke-GeminiKeyProvision -Dependencies $f.Dependencies -Canary) -eq 0) 'canary success'
Assert-True ($f.State.Loads -eq 0 -and $f.State.Checks -eq 2) 'canary never decrypts'
Assert-True ([Text.Encoding]::ASCII.GetString($f.Port.Sent.ToArray()) -ceq "CANARY`n") 'canary payload'
$passed++
foreach ($reply in @('GEMINI KEY CANARY PASS', 'GEMINI KEY EXISTS', 'GEMINI KEY REJECTED', 'GEMINI KEY SAVED extra', 'public-fixture-0123456789')) {
    $f = New-Fixture $reply
    $output = @(Invoke-GeminiKeyProvision -Dependencies $f.Dependencies)
    Assert-True ($output.Count -eq 1 -and $output[0] -eq 1) 'bad reply has no raw output'
    Assert-True ($f.Port.Closed -eq 1 -and $f.Port.Disposed -eq 1) 'bad reply cleanup'
    Assert-True (-not ($f.Port.LastPayload | Where-Object { $_ -ne 0 })) 'bad reply wipe'
}
$passed++
$f = New-Fixture
$f.Port.ThrowWrite = $true
$output = @(Invoke-GeminiKeyProvision -Dependencies $f.Dependencies)
Assert-True ($output.Count -eq 1 -and $output[0] -eq 1) 'write exception redacted'
Assert-True (-not ($f.Port.LastPayload | Where-Object { $_ -ne 0 })) 'write exception wipe'
Assert-True ($f.Port.Closed -eq 1 -and $f.Port.Disposed -eq 1) 'write exception cleanup'
$passed++
$f = New-Fixture
$f.State.Key = 'short'
Assert-True ((Invoke-GeminiKeyProvision -Dependencies $f.Dependencies) -eq 1) 'invalid key error'
Assert-True ($f.State.Opens -eq 0) 'invalid key never opens'
$passed++
$f = New-Fixture
$f.Dependencies.LoadSecret = { throw 'PRIVATE FIXTURE MUST NOT BE DISPLAYED' }
$output = @(Invoke-GeminiKeyProvision -Dependencies $f.Dependencies)
Assert-True ($output.Count -eq 1 -and $output[0] -eq 1) 'decrypt exception redacted'
Assert-True ($f.State.Opens -eq 0) 'decrypt failure never opens'
$passed++
foreach ($arguments in @(
    @('--key', 'PRIVATE_FIXTURE_MUST_NOT_APPEAR'),
    @('-Canary', 'PRIVATE_FIXTURE_MUST_NOT_APPEAR'),
    @('-Port', 'COM7', '-DeviceSerial', 'PUBLIC_SERIAL', '-KeyPath', 'PRIVATE_FIXTURE_MUST_NOT_APPEAR'),
    @('-Port', 'PRIVATE_FIXTURE_MUST_NOT_APPEAR', '-DeviceSerial', 'PUBLIC_SERIAL', '-Canary')
)) {
    $output = @(& powershell -NoProfile -File (Join-Path $PSScriptRoot '../host.ps1') @arguments 2>&1)
    Assert-True ($LASTEXITCODE -eq 1) 'unsupported arguments rejected'
    Assert-True ($output.Count -eq 1 -and $output[0] -ceq 'RESULT NOT CONFIRMED; storage may have changed') 'argument values never echoed'
}
$passed++
Write-Output "GEMINI_HOST_MOCK_PASS $passed"
