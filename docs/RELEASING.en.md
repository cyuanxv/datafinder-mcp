# Release preparation and publication sequence

[简体中文](RELEASING.zh-CN.md)

This is a checklist, not permission to publish. For unpublished forks, set private=true while reviewing locally. Do not create a repository, upload an npm package or submit Registry metadata until the author explicitly approves publication.

## Read-only preparation

Use Node.js 24+ from the source root:

```sh
node standalone/preflight.mjs
node standalone/preflight.mjs --check-account
```

The optional account check only runs npm whoami against the official registry. It does not log in, create tokens, alter access or publish.

The draft npm name is `@cyuanxv/datafinder-mcp`; the Registry name is `io.github.cyuanxv/datafinder-mcp`, currently version 0.2.0. GitHub and npm are separate accounts. A public 404 is not proof of namespace rights or a reservation.

If not logged in, the account owner may complete npm's browser login in their own terminal:

```sh
npm login --auth-type=web --registry=https://registry.npmjs.org
```

Do not send passwords, OTPs or tokens through chat. Rerun the identity check afterwards. A matching npm username establishes the personal namespace identity, but current credential restrictions, email verification, 2FA or organization policy can still affect publication. A different username requires explicit organization permissions or an author-approved scope change.

For an existing package, npm access list collaborators can inspect rights. A nonexistent package cannot prove new-package publishing rights. Do not change access, add owners or create tokens just to test permission.

## Freeze the local release

Match names and versions across the package template, built package and server.json. Preserve the 52-tool installation acceptance, business regression results, secret scan and archive hashes.

```sh
node standalone/build.mjs
cd standalone/package
npm pack --dry-run --json --ignore-scripts
```

This checks the file list, not publishing permissions. Require explicit maintainer approval before publishing. Include MIT, third-party notices, bilingual documentation, Node.js 24+ requirements and read-only defaults. Exclude credentials, databases, real acceptance evidence, HTTP logs and old Git history.

## Only after explicit publication approval

1. Create the new clean repository and apply the prepared description, topics and social preview. Do not make the original private repository public or copy its history.
2. Verify the final repository URL, then add npm and Registry repository metadata. Do not advertise an uncreated repository as existing.
3. With explicit approval for npm publication, remove the private publication guard, set registry/access, rebuild, rescan, freeze the new hashes and perform a publication dry-run. The new metadata changes the distribution hash.
4. Publish with an authorized npm account; the owner handles any OTP without logging it.
5. Read back version and dist.integrity, then install the public package into a fresh directory and run acceptance. Upload completion alone is not publication acceptance.
6. Authenticate mcp-publisher with the intended GitHub identity, submit matching server.json and query the official Registry to confirm the record.
7. Only after public installation works, replace local archive instructions with a verified public npx command. Registry publication does not automatically list the project in ChatGPT.

Recheck name/version availability immediately before publication. Existing published versions cannot be overwritten; local tarballs do not reserve versions.

[Official npm publish documentation](https://docs.npmjs.com/cli/v11/commands/npm-publish/) · [Official Registry quickstart](https://modelcontextprotocol.io/registry/quickstart)
