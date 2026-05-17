# BC Sandbox — Postman collections

These collections target the Microsoft Dynamics Business Central sandbox tenant.

## Files

| File                                            | Purpose                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `NxtClaim.postman_collection.json`              | Custom Alletec Claims API — `POST /companies({{companyId}})/Claims`     |
| `NxtClaimCurrency.postman_collection.json`      | OData reference — currencies                                            |
| `NxtClaimGSTGroupCodes.postman_collection.json` | OData reference — GST Group codes                                       |
| `NxtClaimHSNSACCodes.postman_collection.json`   | OData reference — HSN/SAC codes                                         |
| `bc-sandbox.postman_environment.json`           | Variables: tenant, environment, company, client id/secret, bearer token |

## How to use

1. Import all four collections + the environment file into Postman.
2. Activate the **BC Sandbox** environment.
3. Fill `clientSecret` from your Microsoft Entra ID app registration. (`clientId` is already filled
   with the public app id — it's not a secret, only the secret is.)
4. Run the access-token request inside any collection — it populates `bearerToken`.
5. Every request URL references `{{tenantId}}`, `{{environment}}`, `{{companyId}}`, `{{companyName}}`, `{{clientId}}`
   in place of hardcoded values, so switching environments (sandbox → prod) is a single env-file swap.

## Variables

| Variable       | Purpose                                                  | Sensitive? |
| -------------- | -------------------------------------------------------- | ---------- |
| `tenantId`     | Azure AD tenant GUID                                     | No         |
| `clientId`     | Azure AD app registration ID                             | No         |
| `clientSecret` | Azure AD app secret                                      | **Yes**    |
| `environment`  | BC sandbox / environment name (`Sandbox_…`)              | No         |
| `companyId`    | BC company GUID — used in Custom Claims API URL          | No         |
| `companyName`  | BC company short name — used in OData `Company('…')` URL | No         |
| `bearerToken`  | Runtime OAuth2 access token, auto-set by token request   | **Yes**    |

## Security

`bc-sandbox.postman_environment.json` ships with **empty** `clientSecret` and `bearerToken`.
Fill them locally in a separate file `bc-sandbox.postman_environment.local.json` — that
filename is `.gitignore`d.

The 4 collection files contain **zero hardcoded credentials**: every secret has been
parameterised to a Postman variable. The non-secret identifiers (tenant / company / client
ids) are also parameterised so the same collections work against any BC environment.
