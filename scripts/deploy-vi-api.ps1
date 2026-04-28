param(
  [string]$ProjectId = "tentai-vi-prod",
  [string]$Region = "us-central1",
  [string]$Service = "vi-api",
  [string]$Branch = "main",
  [string]$CommitMessage = ""
)

$ErrorActionPreference = "Stop"

function Step([string]$Label, [scriptblock]$Action) {
  Write-Host ""
  Write-Host "==> $Label" -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "Step failed: $Label (exit code $LASTEXITCODE)"
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

Step "Checking git repository state" {
  git rev-parse --is-inside-work-tree | Out-Null
}

$changes = git status --porcelain
if ($changes) {
  Step "Staging local changes" {
    git add -A
  }

  if ([string]::IsNullOrWhiteSpace($CommitMessage)) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
    $CommitMessage = "chore: local deploy sync $stamp"
  }

  Step "Creating commit" {
    git commit -m $CommitMessage
  }

  Step "Pushing branch '$Branch'" {
    git push origin $Branch
  }
} else {
  Write-Host ""
  Write-Host "==> No local git changes to commit" -ForegroundColor Yellow
}

Step "Building and pushing API image (Cloud Build)" {
  gcloud builds submit --config=cloudbuild.vi-api.yaml --substitutions=_PROJECT_ID=$ProjectId .
}

$image = "$Region-docker.pkg.dev/$ProjectId/cloud-run-source-deploy/vi-api:latest"
Step "Updating Cloud Run service image" {
  gcloud run services update $Service --region $Region --project $ProjectId --image $image
}

Write-Host ""
Write-Host "==> Active Cloud Run revision" -ForegroundColor Green
$revision = gcloud run services describe $Service --region $Region --project $ProjectId --format="value(status.latestReadyRevisionName)"
if ($LASTEXITCODE -ne 0) {
  throw "Failed to read latest revision."
}
Write-Host $revision -ForegroundColor Green

Write-Host ""
Write-Host "Update + deploy complete." -ForegroundColor Green
