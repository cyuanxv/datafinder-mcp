// Prevent accidental live requests. Tests must inject their own fetch fixture.
globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED_IN_TESTS'); };
