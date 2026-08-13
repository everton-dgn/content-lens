# Getting started

This guide covers a local development installation of ContentLens. No public
browser-store release exists yet.

## Requirements

- Node.js 24.x
- pnpm 11.17.0 through Corepack
- Chrome 149 or newer, or Firefox 151 or newer

## Install the project

```sh
corepack enable
pnpm install --frozen-lockfile
```

The lockfile and the `packageManager` field in `package.json` define the exact
dependency graph and pnpm version.

## Run the extension

For Chrome:

```sh
pnpm dev
```

For Firefox:

```sh
pnpm dev:firefox
```

WXT creates the development extension under `.output/`. When Chrome does not
open it automatically, open `chrome://extensions`, enable Developer mode,
choose **Load unpacked**, and select `.output/chrome-mv3`.

## First use

1. Pin ContentLens to the browser toolbar.
2. Select the extension icon to open the side panel.
3. Open **Settings**, choose **Platforms**, and enable only the platform and
   surfaces you want ContentLens to inspect.
4. Approve the exact host requested by the browser.
5. Open **Rules** and create a deterministic allow or block rule.
6. Return to the platform and confirm that hidden content shows a reversible
   placeholder with its reason.
7. Use **Review** to inspect decisions and correct a result.

Rules, feedback and settings are stored in the browser profile. An account,
backend or model provider is not required for deterministic filtering.

## Optional capabilities

Model providers and user-owned synchronization stay disabled until you
configure them in Settings and grant their exact origin. Provider credentials
are not part of portable profile exports.

RSS and Atom subscriptions already stored in a profile remain portable, but
network acquisition is disabled. The interface can pause, resume or remove
stored subscriptions, while creation and editing remain unavailable. Browser
`fetch` cannot bind its connection to the address approved by a separate DNS
check, so enabling acquisition would leave a DNS-rebinding path to private
networks.

## Build packages

```sh
pnpm build:chrome
pnpm build:firefox
```

The generated packages remain under `.output/` and are ignored by Git.

## Troubleshooting

- If generated message keys are stale, run `pnpm i18n:generate`.
- If WXT types are missing, run `pnpm exec wxt prepare`.
- If a platform remains inactive, verify its setting and browser host
  permission before changing selectors.
- If a provider is unavailable, verify its exact endpoint, consent state and
  credential without placing the credential in logs or diagnostics.

For repository structure, tests and release checks, continue with
[Development](development.md).
