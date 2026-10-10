# Browser-only release

This release is a no-login, single-browser version of the engineering workspace.

- PFD/P&ID grouping, PDF intake, and Engineering Data Manager entries are saved in the current browser profile.
- Browser-stored files and records are not shared between devices or browser profiles.
- This release has no central admin library, server sync, or verified native DWG conversion.
- The public site serves compiled static files; the private source repository and company files are not part of this release.
- Browser-delivered JavaScript can be inspected. Do not upload confidential files unless your organization approves this hosting arrangement.

To build the static site, set `VITE_SINGLE_COMPUTER_MODE=true` and `BASE_PATH=/pid-mapping-studio-app/`, then run `pnpm --filter @workspace/pid-mapping-studio run build:pages`.
