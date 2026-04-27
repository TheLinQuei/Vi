# Vi Cloud Run Deployment

This runbook deploys `@vi/api` to Google Cloud Run with Cloud SQL (Postgres), Secret Manager, and Vertex AI.

## 1) Prerequisites

- `gcloud` CLI installed and authenticated
- A GCP project with billing enabled
- Docker or Cloud Build access

Enable required services:

```bash
gcloud services enable run.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com aiplatform.googleapis.com cloudbuild.googleapis.com
```

## 2) Create Cloud SQL Postgres

```bash
gcloud sql instances create vi-postgres --database-version=POSTGRES_16 --cpu=1 --memory=3840MiB --region=us-central1
gcloud sql databases create vi --instance=vi-postgres
gcloud sql users create vi_app --instance=vi-postgres --password="<strong-password>"
```

Build `DATABASE_URL`:

`postgresql://vi_app:<strong-password>@/<db>?host=/cloudsql/<PROJECT_ID>:us-central1:vi-postgres`

## 3) Create Secrets

Create secrets from your local values (example names):

- `vi-database-url`
- `vi-owner-api-key`
- `vi-public-api-key`

```bash
printf "%s" "<database-url>" | gcloud secrets create vi-database-url --data-file=-
printf "%s" "<owner-api-key>" | gcloud secrets create vi-owner-api-key --data-file=-
printf "%s" "<public-api-key>" | gcloud secrets create vi-public-api-key --data-file=-
```

## 4) Service Account + IAM

```bash
gcloud iam service-accounts create vi-api-sa --display-name="Vi API Service Account"
gcloud projects add-iam-policy-binding <PROJECT_ID> --member="serviceAccount:vi-api-sa@<PROJECT_ID>.iam.gserviceaccount.com" --role="roles/aiplatform.user"
gcloud projects add-iam-policy-binding <PROJECT_ID> --member="serviceAccount:vi-api-sa@<PROJECT_ID>.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
gcloud projects add-iam-policy-binding <PROJECT_ID> --member="serviceAccount:vi-api-sa@<PROJECT_ID>.iam.gserviceaccount.com" --role="roles/cloudsql.client"
```

## 5) Deploy Cloud Run

From repo root:

```bash
gcloud run deploy vi-api \
  --source . \
  --region us-central1 \
  --platform managed \
  --service-account vi-api-sa@<PROJECT_ID>.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --port 8080 \
  --set-env-vars API_PORT=8080,VI_PROVIDER=vertexai,VERTEXAI_PROJECT=<PROJECT_ID>,VERTEXAI_LOCATION=us-central1,VERTEXAI_MODEL=gemini-2.5-flash \
  --set-secrets DATABASE_URL=vi-database-url:latest,VI_OWNER_API_KEY=vi-owner-api-key:latest,VI_PUBLIC_API_KEY=vi-public-api-key:latest
```

If using Cloud SQL unix socket connection string, also add:

```bash
--add-cloudsql-instances <PROJECT_ID>:us-central1:vi-postgres
```

## 6) Post-deploy checks

- Call `GET /self-model/owner-control/state` to validate startup/auth wiring.
- Send one `/chat` request and verify provider is `vertexai`.
- Run eval scripts against deployed endpoint before cutover.

## 7) Cutover

- Update clients to cloud `VI_API_BASE_URL`.
- Monitor logs for quota, auth, and DB connection errors.
- Keep local fallback for at least 24h during burn-in.
