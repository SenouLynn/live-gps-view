# Flight simulator continuation

Read [docs/flight-sim-handoff.md](docs/flight-sim-handoff.md) before continuing the incremental simulator work. It contains the authorized scope, working branch, completed changes, validation evidence, and next milestone.

Continue flight simulator work on `main`, as requested by the user. The application and physics milestone are now committed there. Preserve any unrelated local changes; do not reset, clean, or stage everything indiscriminately. Never read or include `.env.local` secrets in handoffs or commits.

For user-visible flight features, add a selectable scenario to **Validation → Flight → Test scenario**, with expected observations and automated checks. Reuse the domain adapters and shared behavior rather than building a separate demo implementation. Read [docs/visual-validation.md](docs/visual-validation.md) for the scenario contract and extension workflow.
