param(
    [string]$BaseUrl = "http://localhost:3000",
    [string]$Login = "",
    [string]$Password = "",
    [int]$RequestTimeoutSec = 15
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Assert-Condition {
    param(
        [bool]$Condition,
        [string]$SuccessMessage,
        [string]$FailureMessage
    )

    if ($Condition) {
        Write-Host "[PASS] $SuccessMessage" -ForegroundColor Green
    } else {
        Write-Host "[FAIL] $FailureMessage" -ForegroundColor Red
        throw $FailureMessage
    }
}

function Invoke-Api {
    param(
        [string]$Method,
        [string]$Url,
        [hashtable]$Headers = @{},
        [object]$Body = $null
    )

    $request = [System.Net.HttpWebRequest]::Create($Url)
    $request.Method = $Method
    $request.Timeout = $RequestTimeoutSec * 1000
    $request.ReadWriteTimeout = $RequestTimeoutSec * 1000
    $request.Accept = "application/json"

    foreach ($key in $Headers.Keys) {
        if ($key -ieq "Content-Type") {
            $request.ContentType = $Headers[$key]
        } else {
            $request.Headers[$key] = $Headers[$key]
        }
    }

    if ($null -ne $Body) {
        $jsonBody = ($Body | ConvertTo-Json -Depth 10 -Compress)
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($jsonBody)
        $request.ContentType = "application/json"
        $request.ContentLength = $bytes.Length
        $requestStream = $request.GetRequestStream()
        $requestStream.Write($bytes, 0, $bytes.Length)
        $requestStream.Close()
    }

    try {
        $response = [System.Net.HttpWebResponse]$request.GetResponse()
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        $content = $reader.ReadToEnd()
        $reader.Close()

        return [PSCustomObject]@{
            StatusCode = [int]$response.StatusCode
            Content = $content
            Headers = $response.Headers
        }
    } catch {
        $webException = $_.Exception
        if (
            $webException -is [System.Management.Automation.MethodInvocationException] -and
            $webException.InnerException -is [System.Net.WebException]
        ) {
            $webException = $webException.InnerException
        }

        if ($webException -is [System.Net.WebException] -and $webException.Status -eq [System.Net.WebExceptionStatus]::Timeout) {
            throw "Request timeout after ${RequestTimeoutSec}s [$Method $Url]"
        }

        if ($webException -is [System.Net.WebException] -and $webException.Response) {
            throw $webException
        }

        throw "Request failed [$Method $Url]. Details: $($webException.Message)"
    }
}

Write-Step "SMOKE TEST START"
Write-Host "Base URL: $BaseUrl"

# 1) Health check
Write-Step "Health check /api/health"
$healthResponse = Invoke-Api -Method "GET" -Url "$BaseUrl/api/health"
$healthBody = $healthResponse.Content | ConvertFrom-Json

Assert-Condition ($healthResponse.StatusCode -eq 200) "Health status code = 200" "Health endpoint did not return 200"
Assert-Condition ($healthBody.status -eq "ok") "Health payload contains status=ok" "Health payload missing status=ok"
Assert-Condition ([string]::IsNullOrWhiteSpace($healthBody.requestId) -eq $false) "Health payload contains requestId" "Health payload missing requestId"
Assert-Condition ([string]::IsNullOrWhiteSpace($healthResponse.Headers["x-request-id"]) -eq $false) "Health headers contain x-request-id" "Health header missing x-request-id"

# 2) Optional login and authorized checks
if (-not [string]::IsNullOrWhiteSpace($Login) -and -not [string]::IsNullOrWhiteSpace($Password)) {
    Write-Step "Login /api/auth/login"
    $loginResponse = Invoke-Api -Method "POST" -Url "$BaseUrl/api/auth/login" -Body @{
        login = $Login
        haslo = $Password
    }
    $loginBody = $loginResponse.Content | ConvertFrom-Json

    Assert-Condition ($loginResponse.StatusCode -eq 200) "Login status code = 200" "Login endpoint did not return 200"
    Assert-Condition ([string]::IsNullOrWhiteSpace($loginBody.token) -eq $false) "Login returned JWT token" "Login did not return token"

    $token = $loginBody.token
    $authHeaders = @{ Authorization = "Bearer $token" }

    Write-Step "Authorized tasks stats /api/tasks/stats"
    $statsResponse = Invoke-Api -Method "GET" -Url "$BaseUrl/api/tasks/stats" -Headers $authHeaders
    Assert-Condition ($statsResponse.StatusCode -eq 200) "Tasks stats status code = 200" "Tasks stats endpoint did not return 200"

    Write-Step "Validation check /api/tasks/12/status (invalid payload)"
    try {
        Invoke-Api -Method "PUT" -Url "$BaseUrl/api/tasks/12/status" -Headers $authHeaders -Body @{
            status = "INVALID"
        } | Out-Null
        throw "Validation endpoint accepted invalid payload unexpectedly"
    } catch {
        $errResponse = $_.Exception.Response
        if ($null -eq $errResponse) {
            throw
        }

        $statusCode = [int]$errResponse.StatusCode
        $reader = New-Object System.IO.StreamReader($errResponse.GetResponseStream())
        $rawErr = $reader.ReadToEnd()
        $reader.Close()

        $errBody = $rawErr | ConvertFrom-Json
        Assert-Condition ($statusCode -eq 400) "Invalid payload returns 400" "Invalid payload did not return 400"
        Assert-Condition ($errBody.error -eq "Nieprawidlowe dane wejsciowe") "Validation error message is correct" "Validation error message mismatch"
        Assert-Condition ([string]::IsNullOrWhiteSpace($errBody.requestId) -eq $false) "Validation error contains requestId" "Validation error missing requestId"
    }
} else {
    Write-Step "Login-dependent checks skipped"
    Write-Host "Provide -Login and -Password to run auth/tasks checks." -ForegroundColor Yellow
}

Write-Step "SMOKE TEST FINISHED"
Write-Host "All executed checks passed." -ForegroundColor Green
