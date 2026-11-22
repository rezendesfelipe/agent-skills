# Naming

Default pattern: `{type}-{name}-{env}-{region}-{seq}`, for example `aks-core-prod-brs-01`.

- `{type}`: the Cloud Adoption Framework abbreviation ([CAF abbreviations](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations)): `vnet`, `snet`, `nsg`, `pep`, `aks`, `cr`, `kv`, `pgsql` (Parte 1's choice for PostgreSQL flexible server), `id`, `rg`.
- `{name}`: what the resource is or whom it serves: `core` for the shared platform, the application name for an app.
- `{env}`, `{region}`, `{seq}`: from the environment and the instance (`brs-01` → region `brs`, seq `01`).

The order of components follows [Define your naming convention](https://learn.microsoft.com/azure/cloud-adoption-framework/ready/azure-best-practices/resource-naming). Only permanent facts go in a name, because most names cannot change after creation; everything else goes in tags.

## Custom patterns

`naming.pattern` takes the five tokens in any order; all five are required, or names of different environments or instances would collide. `naming.separator` is `-` (default), `_` or empty; `naming.abbreviations` overrides abbreviations (`{ pgsql: psql }`).

Derived from the same function: resource names, resource groups (`rg` + separator + main resource name), state keys (`<stack name with the pattern>.tfstate`) and every name in the diagram.

## Resource rules ([name rules](https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules))

| Resource | Rule | Effect |
|---|---|---|
| Container Registry | letters and digits only, 5 to 50 | The separator is dropped: `crcoreprodbrs01` |
| Key Vault | letters, digits and hyphens, 3 to 24, starts with a letter | `_` is rejected; long owners fail |
| PostgreSQL flexible server | lowercase letters, digits and hyphens, 3 to 63 | `_` is rejected |
| AKS | up to 63 | |

`check-manifest` derives every restricted name for every environment and instance and fails with the name and its length. It never shortens a name silently: pick a shorter owner or another pattern.
