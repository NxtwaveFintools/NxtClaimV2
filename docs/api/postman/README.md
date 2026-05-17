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
3. Fill `clientId` and `clientSecret` from your Microsoft Entra ID app registration.
4. Run the access-token request inside any collection — it populates `bearerToken`.
5. The other requests reference `{{bearerToken}}`, `{{tenantId}}`, `{{environment}}`, `{{companyId}}`, `{{companyName}}` — no per-request token paste needed.

## Security

`bc-sandbox.postman_environment.json` ships with **empty** secret values. Local overrides
containing real tokens belong in a file named `bc-sandbox.postman_environment.local.json`,
which is `.gitignore`d.

The collections were originally committed with hardcoded bearer tokens (sandbox/test env);
those have been parameterised but a `git log -p` reveals the historical strings. If you
need to scrub the history, see `git filter-repo`.
