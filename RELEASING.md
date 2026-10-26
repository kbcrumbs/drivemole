# Releasing DriveMole

## Cutting a release

1. Bump `version` in `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` (and `package.json`), commit and push.
2. Tag and push:
   ```bash
   git tag -a v1.2.3 -m "DriveMole v1.2.3"
   git push origin v1.2.3
   ```
3. The **Release** workflow builds the Windows installers and a portable `.exe`, signs them if signing is set up, and attaches them to a **draft** GitHub Release. Write the notes and publish it.
4. Publish to crates.io from your machine:
   ```bash
   npm run build
   cd src-tauri
   cargo build      # refreshes gen/schemas
   cargo publish
   ```

To rebuild an existing tag, run the workflow manually from the **Actions** tab with the tag name. Leave **upload** unticked to just download the builds from the run, or tick it to replace the files on that release.

## Windows code signing (Azure Artifact Signing)

The workflow signs builds automatically once these are configured. Until then it produces unsigned builds.

### 1. Azure app registration

The workflow signs as an app registration (a service account), not as you.

1. In the Azure portal, open **Microsoft Entra ID** → **App registrations** → **New registration**. Name it `drivemole-github-signing`, choose **single tenant**, and register.
2. On its **Overview** page, note the **Application (client) ID** and **Directory (tenant) ID**.
3. Open **Certificates & secrets** → **New client secret**, give it an expiry, and copy the **Value** straight into GitHub (next step). It's only shown once.
4. In your Artifact Signing account, open **Access control (IAM)** → **Add role assignment** → **Artifact Signing Certificate Profile Signer** → **Members: User, group, or service principal** → select `drivemole-github-signing`.

### 2. GitHub settings

In the repo, open **Settings** → **Secrets and variables** → **Actions**.

**Secrets** tab:

| Name | Value |
|---|---|
| `AZURE_CLIENT_ID` | Application (client) ID |
| `AZURE_TENANT_ID` | Directory (tenant) ID |
| `AZURE_CLIENT_SECRET` | The client secret value |

**Variables** tab:

| Name | Example |
|---|---|
| `AZURE_SIGNING_ENDPOINT` | `https://eus.codesigning.azure.net` |
| `AZURE_SIGNING_ACCOUNT` | Your Artifact Signing account name |
| `AZURE_SIGNING_PROFILE` | Your certificate profile name |

Or from a terminal (each command prompts for the value, so it never lands in your shell history):

```bash
gh secret set AZURE_CLIENT_ID
gh secret set AZURE_TENANT_ID
gh secret set AZURE_CLIENT_SECRET
gh variable set AZURE_SIGNING_ENDPOINT
gh variable set AZURE_SIGNING_ACCOUNT
gh variable set AZURE_SIGNING_PROFILE
```

Setting `AZURE_SIGNING_ENDPOINT` is what switches signing on. The workflow then fails if any file comes out unsigned, so a misconfiguration can't silently publish unsigned builds.

The client secret expires; when it does, create a new one and update `AZURE_CLIENT_SECRET`.
