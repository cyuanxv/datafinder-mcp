# Development guidelines

Use synthetic fixtures. Never add credentials, real business exports, customer identifiers or production configuration. Run npm test, npm run typecheck and npm run build under site/. Tests must not contact a live tenant. Do not remove upstream safety checks, bypass preview/confirmation, or enable destructive operations. Deployment and publication require the repository owner's explicit authorization.
